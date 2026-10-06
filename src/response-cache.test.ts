import { test, expect } from 'bun:test';
import { Hono } from 'hono';
import { privateApiResponses } from './response-cache';

test('API no-store policy covers login, session, protected errors and successful reads', async () => {
  const app = new Hono();
  app.use('/api/*', privateApiResponses);
  app.get('/api/me', c => c.json({authenticated:false}));
  app.post('/api/login', c => c.json({ok:false},401));
  app.get('/api/protected', c => c.json({ok:false},403));
  app.get('/api/data', c => c.json({ok:true}));
  for (const [url, method] of [['/api/me','GET'],['/api/login','POST'],['/api/protected','GET'],['/api/data','GET'],['/api/missing','GET']]) {
    const response = await app.request(url,{method});
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
  }
});
