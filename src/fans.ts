import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { ON_HOST } from './host';
import { boundedCommand } from './storage/host-argv';
export type FanRunner = (request: Record<string, unknown>) => Promise<any>;
export const fanRunner: FanRunner = async request => {
  const source = await readFile(new URL('./fans-host.py', import.meta.url), 'utf8');
  const command = ['python3', '-c', source];
  const argv = ON_HOST ? command : ['nsenter', '-t', '1', '-m', '-u', '-i', '-n', '-p', '--', ...command];
  return JSON.parse(await boundedCommand(argv, JSON.stringify(request), undefined, 8000));
};
export function registerFanRoutes(app: Hono, run: FanRunner = fanRunner): void {
  app.get('/api/fans', async c => {
    try { const r = await run({ action: 'status' }); return c.json(r, r.ok ? 200 : 503); }
    catch { return c.json({ ok: false, available: false, error: 'No se pudo consultar el servicio de ventiladores.' }, 503); }
  });
  app.post('/api/fans', async c => {
    const b = await c.req.json().catch(() => null);
    if (!b || !['auto','max','manual'].includes(b.mode) || !Number.isInteger(b.revision) || b.revision < 0 ||
        Object.keys(b).some(k => !['mode','cpu','gpu','minutes','revision'].includes(k)) ||
        (b.mode === 'manual' && (![b.cpu,b.gpu].every(v => Number.isInteger(v) && v >= 20 && v <= 100) || ![15,30,60].includes(b.minutes))))
      return c.json({ ok: false, error: 'Elegí un modo válido, potencia entre 20 y 100% y un período de 15, 30 o 60 minutos.' }, 400);
    try { const r = await run({ action: 'set', ...b }); return c.json(r, r.ok ? 200 : 409); }
    catch { return c.json({ ok: false, error: 'No se confirmó el cambio. Actualizá el estado antes de volver a aplicar.' }, 503); }
  });
}
export function fixtureFanRunner(): FanRunner {
  let value = { ok: true, available: true, fixture: true, model: 'Acer Predator PT315-53', bios: 'V1.14', revision: 0, mode: 'auto', effectiveMode: 'auto', cpu: 60, gpu: 60, cpuRpm: 2400, gpuRpm: 2300, cpuTemp: 48, gpuTemp: 45, remainingSeconds: null as number | null, override: '', reason: '', limits: { minPercent: 20, cpuMaxTemp: 85, gpuMaxTemp: 80 } };
  return async r => {
    if (r.action === 'set') {
      if (r.revision !== value.revision) return { ok: false, error: 'El estado cambió. Actualizá antes de aplicar.' };
      value = { ...value, revision: value.revision + 1, mode: String(r.mode), effectiveMode: String(r.mode), cpu: Number(r.cpu || 100), gpu: Number(r.gpu || 100), remainingSeconds: r.mode === 'manual' ? Number(r.minutes) * 60 : null };
    }
    return structuredClone(value);
  };
}
