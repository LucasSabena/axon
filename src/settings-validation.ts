import type { AppConfig } from './types';

// notifyUrl is fetched on every alert — it must not point at loopback,
// link-local or other reserved addresses (cloud metadata, admin panels).
function forbiddenV4(a: number, b: number): boolean {
  return a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224;
}

// IPv4 embedded in an IPv6-mapped/transition address — WHATWG serializes these
// in compressed hex ([::ffff:7f00:1]), never the dotted form, so the last two
// hex groups must be decoded. Covers ::ffff/96 and NAT64 64:ff9b::/96.
function embeddedV4(v6: string): [number, number, number, number] | null {
  // ::/96 (deprecated IPv4-compatible, e.g. ::7f00:1) decodes the same way —
  // every ::H:H address is inside ::/96, so decoding as embedded v4 is safe.
  const m = v6.match(/^(?:::ffff:|64:ff9b::|::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!m) return null;
  const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
  return [hi >> 8, hi & 255, lo >> 8, lo & 255];
}

export function isForbiddenWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::' || v6 === '::1' || /^fe[89ab]/.test(v6) || /^f[cd]/.test(v6)) return true;
    const v4 = embeddedV4(v6);
    return v4 ? forbiddenV4(v4[0], v4[1]) : false;
  }
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) return forbiddenV4(Number(ipv4[1]), Number(ipv4[2]));
  return false;
}

// Webhook URLs embed secrets (Discord/Gotify tokens, ntfy topics). Responses
// must show this masked form instead of the raw URL; when a client echoes the
// mask back unchanged, the stored secret is preserved (see validateSettings).
export function maskWebhookUrl(value: string): string {
  if (!value) return '';
  let url: URL;
  try { url = new URL(value); } catch { return '•••'; }
  const path = url.pathname.split('/').map(seg => (seg.length > 6 ? seg.slice(0, 3) + '…' : seg)).join('/');
  const tail = url.search ? url.search.replace(/[^?&=]{4,}/g, '…') : '';
  return url.origin + path + tail;
}

export function validateSettings(input: unknown, current?: Partial<AppConfig['settings']>): Partial<AppConfig['settings']> {
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
      // The client echoes back the masked URL it was shown; keep the secret.
      if (value && current?.notifyUrl && value === maskWebhookUrl(current.notifyUrl)) { out[key] = current.notifyUrl; continue; }
      else if (value) { let url: URL; try { url = new URL(value); } catch { throw new Error('Webhook inválido'); } if (!['http:', 'https:'].includes(url.protocol)) throw new Error('El webhook debe usar HTTP o HTTPS'); if (isForbiddenWebhookHost(url.hostname)) throw new Error('El webhook no puede apuntar a una dirección reservada'); }
    } else if (key === 'knownServices') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100 || Object.entries(value).some(([port, svc]) => !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !svc || typeof svc.name !== 'string' || !svc.name.trim() || svc.name.length > 128 || (svc.icon != null && (typeof svc.icon !== 'string' || svc.icon.length > 64 || !/^[a-z0-9-]*$/.test(svc.icon))))) throw new Error('Servicios conocidos inválidos');
    }
    out[key] = value;
  }
  return out;
}
