import type { MiddlewareHandler } from 'hono';

// Auth and API responses must never be retained by a browser or shared CDN.
// Installed before routes so short-circuit auth/errors get the same policy.
export const privateApiResponses: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('CDN-Cache-Control', 'no-store');
  c.header('Cloudflare-CDN-Cache-Control', 'no-store');
  await next();
};
