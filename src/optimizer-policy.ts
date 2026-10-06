import type { ContainerInfo } from './optimizer-collector';
import type { DomainMapping } from './types';
import { auditedDatabase } from './optimizer-activity';

export type Importance = 'unknown' | 'always' | 'sometimes';
export interface Preference { importance: Importance; created: string; image: string }

const profiles: [RegExp, string, string, boolean][] = [
  [/axon/i, 'Axon', 'El panel que estás usando para administrar el servidor.', true],
  [/cloudflared|tailscale|wireguard|traefik|nginx|caddy/i, 'Acceso y conexiones', 'Permite acceder a aplicaciones o encamina conexiones. Apagarlo puede dejarte sin acceso.', true],
  [/authentik|authelia|keycloak/i, 'Inicio de sesión', 'Gestiona el acceso y las cuentas de otras aplicaciones.', true],
  [/vaultwarden|bitwarden/i, 'Contraseñas', 'Tu gestor de contraseñas. Apagarlo interrumpe el acceso y la sincronización.', true],
  [/postgres|pgvector|mariadb|mysql|redis|mongo|(?:^|[-/])db(?:$|[-:])/i, 'Datos de aplicaciones', 'Guarda datos o sostiene otras aplicaciones. Primero hay que identificar quién lo usa.', true],
  [/steel-browser/i, 'Navegador para agentes', 'Los agentes lo usan para navegar y automatizar tareas. Apagarlo corta las sesiones abiertas.', false],
  [/chromium|chrome/i, 'Navegador remoto', 'Un navegador que corre en el servidor. Apagarlo cierra sus sesiones.', false],
  [/linkwarden/i, 'Enlaces guardados', 'Guarda y organiza enlaces y sus copias. Apagarlo interrumpe consultas y tareas de archivado.', false],
  [/homepage/i, 'Página de inicio', 'Un tablero con enlaces y estado de tus aplicaciones. Deja de estar disponible al apagarlo.', false],
  [/uptime-kuma/i, 'Monitoreo', 'Comprueba si tus aplicaciones están disponibles. Apagarlo pausa el seguimiento y sus alertas.', false],
  [/vikunja/i, 'Tareas', 'Gestiona listas, proyectos y tareas. Deja de estar disponible al apagarlo.', false],
  [/portainer/i, 'Administración de Docker', 'Otro panel para administrar contenedores. Sus tareas en curso se interrumpen al apagarlo.', false],
  [/filebrowser/i, 'Explorador de archivos', 'Permite navegar y subir archivos. Apagarlo interrumpe transferencias activas.', false],

];

export function assessContainer(c: ContainerInfo, all: ContainerInfo[], preferences: Record<string, Preference>, domains: DomainMapping[], selfId = '') {
  const profile = profiles.find(([re]) => re.test(`${c.name} ${c.image}`));
  const audited = auditedDatabase(c);
  const pref = preferences[c.id];
  const importance: Importance = pref?.created === c.created && pref.image === c.image ? pref.importance : audited ? 'sometimes' : 'unknown';
  const dependents = all.filter(other => other.id !== c.id && other.state === 'running' && c.project && other.project === c.project && other.dependencies.includes(c.service)).map(o => o.name);
  const connections = domains.filter(d => d.projectName === c.name || d.projectName === c.project || c.ports.includes(d.port)).map(d => d.fullDomain);
  const self = !!selfId && (c.id.startsWith(selfId) || selfId.startsWith(c.id));
  const critical = self || (!!profile?.[3] && !audited);
  const blocked = critical ? 'Protegido: sostiene el acceso, la administración o los datos.' : dependents.length ? `Lo necesitan: ${dependents.join(', ')}.` : importance === 'always' ? 'Lo marcaste como siempre encendido.' : importance !== 'sometimes' ? 'Todavía no decidiste si se puede apagar.' : null;
  return { ...c, title: audited ? 'Base de desarrollo local' : profile?.[1] || c.name, purpose: audited?.purpose || profile?.[2] || 'No identificado. Revisá para qué lo usás antes de permitir que se apague.', identified: !!profile, importance, dependents, connections, auditedLocal: !!audited, critical, blocked, canStop: !blocked && c.state === 'running' };
}

export function sustainedHigh(points: { at: number; cpu: number }[], threshold = 85) {
  if (!points.length) return 0;
  let start = points.at(-1)!.at;
  let previous = start;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.cpu < threshold || previous - p.at > 45_000) break;
    start = p.at; previous = p.at;
  }
  return Math.max(0, points.at(-1)!.at - start);
}
