import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived, file-specific links so a file dragged out of Archivos can be fetched by the
// app it lands in (Figma, a chat, an editor) without the AXON session cookie.
export const DRAG_LINK_TTL_MS = 15 * 60_000;
const sign = (secret: string, payload: string) => createHmac('sha256', secret).update('axon-drag-link:' + payload).digest('base64url');

export function createDragToken(secret: string, filePath: string, now = Date.now()): { token: string; expiresAt: number } {
  if (!secret) throw new Error('Falta la clave de sesión');
  const expiresAt = now + DRAG_LINK_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ p: filePath, e: expiresAt })).toString('base64url');
  return { token: payload + '.' + sign(secret, payload), expiresAt };
}

export function readDragToken(secret: string, token: string, now = Date.now()): string | null {
  if (!secret || typeof token !== 'string' || token.length > 8192) return null;
  const [payload, mac, extra] = token.split('.');
  if (!payload || !mac || extra !== undefined) return null;
  const want = Buffer.from(sign(secret, payload)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data?.p !== 'string' || typeof data?.e !== 'number' || data.e < now) return null;
    return data.p;
  } catch { return null; }
}
