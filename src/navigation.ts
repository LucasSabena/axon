import type { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { SECTIONS } from '../public/navigation-model.js';

// Only known application routes serve the shell. Missing APIs, assets and
// share links retain their own 404/auth behavior.
export function registerNavigationRoutes(app: Hono): void {
  const shell = serveStatic({ path: './public/index.html' });
  app.use('*', async (c, next) => {
    if (Object.values(SECTIONS).some(([p]) => c.req.path === '/respaldos' || c.req.path === '/respaldos/' || c.req.path === p || (p !== '/' && c.req.path === p + '/'))) {
      c.header('CDN-Cache-Control', 'no-store');
      c.header('Cloudflare-CDN-Cache-Control', 'no-store');
    }
    await next();
  });
  for (const alias of ['/respaldos','/respaldos/']) app.get(alias, async(c,next)=>{c.header('Cache-Control','private, no-store');return shell(c,next);});
  for (const [pathname] of Object.values(SECTIONS) as [string, string][]) {
    app.get(pathname, async (c, next) => { c.header('Cache-Control', 'private, no-store'); return shell(c, next); });
    if (pathname !== '/') app.get(pathname + '/', async (c, next) => { c.header('Cache-Control', 'private, no-store'); return shell(c, next); });
  }
}
