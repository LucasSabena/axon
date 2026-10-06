import type { AppConfig } from './types';
export function validateSettings(input: unknown): Partial<AppConfig['settings']> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuración inválida');
  const src = input as Record<string, unknown>, out: Record<string, unknown> = {};
  const keys = new Set(['scanIntervalMs', 'protectedPids', 'protectedPorts', 'ignoredPatterns', 'scanDirs', 'hostUser', 'notifyUrl', 'notifyProvider', 'knownServices']);
  for (const [key, value] of Object.entries(src)) {
    if (!keys.has(key)) throw new Error(`Campo desconocido: ${key}`);
    if (key === 'scanIntervalMs') {
      if (!Number.isInteger(value) || Number(value) < 1000 || Number(value) > 60_000) throw new Error('El intervalo debe estar entre 1000 y 60000 ms');
    } else if (key === 'protectedPids' || key === 'protectedPorts') {
      if (!Array.isArray(value) || value.length > 1000 || value.some(v => !Number.isInteger(v) || v < 1 || v > (key === 'protectedPorts' ? 65535 : 2_147_483_647))) throw new Error(`Valores inválidos en ${key}`);
    } else if (key === 'scanDirs' || key === 'ignoredPatterns') {
      if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string' || v.length > 4096 || v.includes('\0') || (key === 'scanDirs' && !v.startsWith('/')))) throw new Error(`Valores inválidos en ${key}`);
    } else if (key === 'hostUser') {
      if (typeof value !== 'string' || !/^[a-z_][a-z0-9_-]*[$]?$/.test(value)) throw new Error('Usuario del host inválido');
    } else if (key === 'notifyProvider') {
      if (typeof value !== 'string' || !['auto','ntfy','gotify','discord'].includes(value)) throw new Error('Proveedor de notificaciones inválido');
    } else if (key === 'notifyUrl') {
      if (typeof value !== 'string') throw new Error('Webhook inválido');
      if (value) { let url: URL; try { url = new URL(value); } catch { throw new Error('Webhook inválido'); } if (!['http:', 'https:'].includes(url.protocol)) throw new Error('El webhook debe usar HTTP o HTTPS'); }
    } else if (key === 'knownServices') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([port, svc]) => !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !svc || typeof svc.name !== 'string' || !svc.name.trim() || (svc.icon != null && (typeof svc.icon !== 'string' || !/^[a-z0-9-]*$/.test(svc.icon))))) throw new Error('Servicios conocidos inválidos');
    }
    out[key] = value;
  }
  return out;
}
