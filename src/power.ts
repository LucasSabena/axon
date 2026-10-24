import type { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { ON_HOST } from './host';
import { boundedCommand } from './storage/host-argv';
export type PowerRunner = (request: Record<string, unknown>) => Promise<any>;
export const powerRunner: PowerRunner = async request => {
  const source = await readFile(new URL('./power-host.py', import.meta.url), 'utf8');
  const command = ['python3', '-c', source];
  const argv = ON_HOST ? command : ['nsenter', '-t', '1', '-m', '-u', '-i', '-n', '-p', '--', ...command];
  return JSON.parse(await boundedCommand(argv, JSON.stringify(request), undefined, 8000));
};
const MODES = ['performance', 'balanced', 'quiet'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
function validSchedule(schedule: unknown): boolean {
  if (!Array.isArray(schedule) || schedule.length > 10) return false;
  return schedule.every(e => e && typeof e === 'object' && !Array.isArray(e) &&
    Object.keys(e).every(k => ['start', 'end', 'mode', 'days'].includes(k)) &&
    typeof e.start === 'string' && TIME.test(e.start) && typeof e.end === 'string' && TIME.test(e.end) && e.start !== e.end &&
    typeof e.mode === 'string' && MODES.includes(e.mode) &&
    (e.days === undefined || Array.isArray(e.days) && e.days.length > 0 && e.days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)));
}
export function registerPowerRoutes(app: Hono, run: PowerRunner = powerRunner): void {
  app.get('/api/power', async c => {
    try { const r = await run({ action: 'status' }); return c.json(r, r.ok ? 200 : 503); }
    catch { return c.json({ ok: false, available: false, error: 'No se pudo consultar el servicio de energía.' }, 503); }
  });
  app.post('/api/power', async c => {
    const b = await c.req.json().catch(() => null);
    if (!b || !Number.isInteger(b.revision) || b.revision < 0 ||
        Object.keys(b).some(k => !['mode', 'schedule', 'revision'].includes(k)) ||
        (b.mode !== undefined && !['auto', ...MODES].includes(b.mode)) ||
        (b.schedule !== undefined && !validSchedule(b.schedule)) ||
        (b.mode === undefined && b.schedule === undefined))
      return c.json({ ok: false, error: 'Elegí un modo válido y horarios con formato HH:MM, modo y días 0–6.' }, 400);
    try { const r = await run({ action: 'set', ...b }); return c.json(r, r.ok ? 200 : 409); }
    catch { return c.json({ ok: false, error: 'No se confirmó el cambio. Actualizá el estado antes de volver a aplicar.' }, 503); }
  });
}
export function fixturePowerRunner(): PowerRunner {
  let value = { ok: true, available: true, fixture: true, model: 'Predator PT315-53', revision: 0,
    mode: 'auto', effectiveMode: 'balanced', source: 'predeterminado', modeName: 'Equilibrado',
    schedule: [] as any[], nextChange: null as any,
    knobs: { turbo: true, maxPerfPct: 100, profile: 'balanced', epp: 'balance_performance', raplPl1Watts: 90, raplPl2Watts: 115, gpuClock: null, gpuError: null, gpuPowerState: 'D0', quietFans: false },
    capabilities: { rapl: true, gpu: true, fans: true, profile: 'power-profiles-daemon' },
    limits: { modes: ['performance', 'balanced', 'quiet'], scheduleMax: 10, quietMaxPerfPct: 55, raplDefaults: [90, 115] } };
  return async r => {
    if (r.action === 'set') {
      if (r.revision !== value.revision) return { ok: false, error: 'El estado cambió. Actualizá antes de aplicar.' };
      const mode = r.mode ? String(r.mode) : value.mode;
      const schedule = r.schedule ? (r.schedule as any[]) : value.schedule;
      const effective = mode === 'auto' ? (schedule[0]?.mode || 'balanced') : mode;
      value = { ...value, revision: value.revision + 1, mode, schedule,
        effectiveMode: effective, source: mode === 'auto' ? (schedule[0] ? 'horario' : 'predeterminado') : 'manual',
        modeName: ({ performance: 'Rendimiento', balanced: 'Equilibrado', quiet: 'Silencioso' } as any)[effective],
        knobs: { ...value.knobs, turbo: effective !== 'quiet', maxPerfPct: effective === 'quiet' ? 55 : 100,
          profile: effective === 'quiet' ? 'power-saver' : effective, raplPl1Watts: effective === 'quiet' ? 35 : 90,
          raplPl2Watts: effective === 'quiet' ? 50 : 115, quietFans: effective === 'quiet' } };
    }
    return structuredClone(value);
  };
}
