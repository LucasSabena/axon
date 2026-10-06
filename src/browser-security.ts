import type { MiddlewareHandler } from 'hono';

/** Match the public request origin behind the TLS-terminating proxy, including port. */
export function requestOriginAllowed(request: Request): boolean {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = request.headers.get('origin');
  // Non-browser authenticated clients may omit Origin. Browser writes carry it.
  if (!origin) return true;
  try {
    const incoming = new URL(origin);
    if (!['http:','https:'].includes(incoming.protocol) || incoming.origin !== origin) return false;
    const url = new URL(request.url);
    const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const scheme = forwarded === 'http' || forwarded === 'https' ? forwarded + ':' : url.protocol;
    const host = request.headers.get('host') || url.host;
    const expected = new URL(`${scheme}//${host}`);
    return incoming.origin === expected.origin;
  } catch { return false; }
}

export const browserWriteGuard: MiddlewareHandler = async (c, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(c.req.method) && !requestOriginAllowed(c.req.raw))
    return c.json({ok:false,error:'El origen de esta acción no está permitido.'},403);
  await next();
};

/** Never accept protocol-relative URLs, backslashes, control characters or another origin. */
export function safePairTarget(input: string | undefined): string {
  if (!input || !input.startsWith('/') || input.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(input)) return '/';
  try {
    const target = new URL(input, 'https://axon.invalid');
    return target.origin === 'https://axon.invalid' ? target.pathname + target.search + target.hash : '/';
  } catch { return '/'; }
}
