import type { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { SECTIONS } from '../public/navigation-model.js';

// Only known application routes serve the shell. Missing APIs, assets and
// share links retain their own 404/auth behavior.
export function registerNavigationRoutes(app: Hono): void {
  for (const [pathname] of Object.values(SECTIONS) as [string, string][]) {
    app.get(pathname, serveStatic({ path: './public/index.html' }));
    if (pathname !== '/') app.get(pathname + '/', serveStatic({ path: './public/index.html' }));
  }
}
