import { createHash } from 'node:crypto';
import path from 'node:path';
import { MaintenanceError } from './types';
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Normalize before comparing: a pure prefix check would accept '/a/../x' as inside '/a'.
export const within = (p: string, root: string) => {const n=path.normalize(p),r=path.normalize(root).replace(/\/$/,'');return n===r||n.startsWith(r+'/');};
export const PROTECTED = /(?:^|\/)(?:\.ssh|\.gnupg|\.git|node_modules|\.env(?:\.[^/]*)?|credentials?|secrets?)(?:\/|$)/i;
export function exclusions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(p=>typeof p!=='string'||!p.startsWith('/')||p.includes('\0')||path.normalize(p)!==p||p.length>2048)) throw new MaintenanceError('Ingresá hasta 100 rutas absolutas normalizadas',400);
  const list=[...new Set(value as string[])].sort();
  // The scan worker reads at most 128 KiB of stdin; the serialized exclusions must fit.
  if (JSON.stringify({exclusions:list}).length>96*1024) throw new MaintenanceError('La lista de exclusiones supera el límite del worker; reducí la cantidad o la longitud de las rutas',400);
  return list;
}
export const policyRevision = (paths: string[]) => hash({ version: 1, paths, protected: PROTECTED.source });
export const CAPABILITIES = [
  {id:'trash',name:'Papeleras XDG y Axon',reason:'Listado, restauración sin sobrescritura y migración legacy → XDG por selección revisada, conservando origen y fecha. Vaciado permanente de la selección con árbol congelado y verificación; cruce de filesystem al enviar a papelera bloqueado.'},
  {id:'packages',name:'Descargas APT, pip y uv',reason:'pip permite seleccionar caché propia sin gestores activos. uv se conserva para su gestor nativo; APT requiere un adapter privilegiado específico.'},
  {id:'builds',name:'Rust incremental',reason:'Selección incremental de proyectos registrados; se omite ante compiladores activos o lectura de procesos incompleta.'},
  {id:'remote',name:'Versiones VS Code / Devin y Snap',reason:'VS Code: layouts bin y cli/servers conocidos, sin procesos o enlaces actuales. Devin desconocido y Snap quedan en revisión.'},
  {id:'pnpm',name:'Almacén pnpm',reason:'Puede contener ejecutables activos y enlaces compartidos. Sin dry-run validado; no se estima ahorro ni se poda.'},
  {id:'logs',name:'Journal y Docker build',reason:'La limpieza Docker de Salud conserva su alcance de siete días. Journal necesita una política de retención aprobada.'},
  {id:'agents',name:'Historial OpenCode',reason:'Esquema y versión sin certificar: no se leen mensajes ni se ejecuta SQL de borrado o VACUUM.'},
  {id:'backups',name:'Respaldos y modelos',reason:'Revisión únicamente. Restic, perfiles, Whisper y Hugging Face pueden ser dependencias funcionales.'},
].map(c=>({...c,version:1,canExecute:['trash','packages','builds','remote'].includes(c.id)}));
