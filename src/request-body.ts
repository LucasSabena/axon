import type { MiddlewareHandler } from 'hono';

/** Binary blocks stay streamed by their upload service; control bodies are bounded before parsing. */
export function requestBodyLimit(pathname: string, method: string): number | null {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return null;
  if (method === 'PUT' && /^\/api\/(?:files\/upload\/[^/]+|library\/upload\/[^/]+|v1\/cloud\/uploads\/[^/]+)$/.test(pathname)) return null;
  if (pathname === '/api/drop/file') return 50 * 1024 * 1024 + 65536;
  if (/^\/api\/software\/icons\/[^/]+\/upload$/.test(pathname)) return 2 * 1024 * 1024 + 65536;
  if (pathname.startsWith('/api/v1/')) return 16384;
  if (pathname === '/pair' || /^\/(?:s|x\/drop)\//.test(pathname) ||
      /^\/api\/(?:login|auth\/|onboarding\/setup)/.test(pathname)) return 8192;
  if (pathname.startsWith('/api/')) return 8 * 1024 * 1024;
  return null;
}

export const boundedRequestBody: MiddlewareHandler = async (c, next) => {
  const limit = requestBodyLimit(c.req.path, c.req.method);
  if (limit === null || !c.req.raw.body) return next();
  const tooLarge = () => c.json({ ok: false, error: 'Solicitud demasiado grande' }, 413);
  // Check both the declared length and the bytes actually read. A streaming
  // client may omit Content-Length, and parsing first defeats a memory bound.
  if (Number(c.req.header('content-length')) > limit) return tooLarge();
  const reader = c.req.raw.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); return tooLarge(); }
      chunks.push(value);
    }
  } catch { return c.json({ ok: false, error: 'La solicitud se interrumpió' }, 400); }
  finally { reader.releaseLock(); }
  c.req.raw = new Request(c.req.raw, { body: Buffer.concat(chunks), duplex: 'half' } as RequestInit);
  return next();
};
