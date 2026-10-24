import type { Hono } from 'hono';
import { body, only, protect } from './storage/http';
import { MaintenanceError } from './storage/types';
import { BUN_BIN, CONTAINER, OPENCODE_BIN, clean, lastLines, q, runWithStdin, safeJson, sh } from './openbot-shared';

/* Proveedores de modelos del OpenCode que corre DENTRO de OpenBot (no el del host: son instalaciones
 * separadas y no comparten credenciales). Las claves viajan por stdin y nunca se devuelven al navegador:
 * solo se informa qué proveedores tienen credencial y de qué tipo. El login por OAuth (ChatGPT, Copilot)
 * no se maneja desde acá. */

export const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,60}$/;
export const API_KEY = /^[\x21-\x7e]{8,600}$/;      // ASCII imprimible, sin espacios
const NO_KEY_PROVIDERS = new Set(['github-copilot', 'opencode']); // Copilot = OAuth; "opencode" gratuito no necesita clave

export interface CatalogProvider { id: string; name: string; models: number }
export interface ProviderRow { id: string; name: string; type: string; models: number }

// Corre dentro del contenedor con el bun de OpenBot. Lee la caché de modelos de OpenCode y auth.json.
const READ_JS = String.raw`
const fs = require("fs");
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const models = read("/data/.cache/opencode/models.json", {});
const auth = read("/data/.local/share/opencode/auth.json", {});
const catalog = Object.entries(models).map(([id, p]) => ({ id, name: p.name || id, models: Object.keys(p.models || {}).length }));
const saved = Object.entries(auth).map(([id, v]) => ({ id, type: (v && v.type) || "?" }));
console.log(JSON.stringify({ catalog, saved }));
`;

// Escribe/quita una credencial. Entrada por stdin: {action, provider, key?}. No imprime la clave.
const WRITE_JS = String.raw`
const fs = require("fs");
const dir = "/data/.local/share/opencode", file = dir + "/auth.json";
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const { action, provider, key } = JSON.parse(input);
  let auth = {};
  try { auth = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (action === "set") auth[provider] = { type: "api", key };
  else if (action === "remove") delete auth[provider];
  else throw new Error("accion");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file + ".tmp", JSON.stringify(auth, null, 2), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
  console.log(JSON.stringify({ ok: true, providers: Object.keys(auth) }));
});
`;

const b64 = (s: string) => Buffer.from(s).toString('base64');
const inContainer = (script: string, stdin = false) => `docker exec ${stdin ? '-i ' : ''}-e HOME=/data ${CONTAINER} sh -c ${q(`${BUN_BIN}; test -n "$BUN" || exit 3; echo ${b64(script)} | base64 -d > /tmp/.axon-p.js; "$BUN" /tmp/.axon-p.js${stdin ? '' : ''}; rc=$?; rm -f /tmp/.axon-p.js; exit $rc`)}`;

export function modelCounts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of clean(text).split('\n')) {
    const m = line.trim().match(/^([a-z0-9._-]+)\/\S+$/);
    if (m) out[m[1]] = (out[m[1]] || 0) + 1;
  }
  return out;
}

export function pickTestModel(models: string[]): string | null {
  const own = models.filter((m) => /^[A-Za-z0-9._\/:-]{1,120}$/.test(m));
  return own.find((m) => /flash|mini|lite|small|haiku|nano|turbo/i.test(m)) || own[0] || null;
}

export async function readProviders() {
  const r = await sh(`${inContainer(READ_JS)}; echo '@@MODELS'; docker exec -e HOME=/data ${CONTAINER} sh -c ${q(`${OPENCODE_BIN}; $B models 2>/dev/null`)}`, 60_000);
  const [head, models = ''] = r.stdout.split('@@MODELS');
  const data = safeJson<{ catalog: CatalogProvider[]; saved: { id: string; type: string }[] }>(head.trim().split('\n').pop() || '');
  if (!data) throw new MaintenanceError('No se pudo leer la configuración de proveedores de OpenBot', 503);
  const counts = modelCounts(models);
  const names = new Map(data.catalog.map((p) => [p.id, p.name]));
  const providers: ProviderRow[] = data.saved.map((s) => ({ id: s.id, name: names.get(s.id) || s.id, type: s.type, models: counts[s.id] || 0 }));
  const free = counts.opencode || 0;
  const addable = data.catalog.filter((p) => !NO_KEY_PROVIDERS.has(p.id)).sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ id: p.id, name: p.name }));
  return { providers, freeModels: free, totalModels: Object.values(counts).reduce((a, b) => a + b, 0), addable };
}

async function writeCredential(action: 'set' | 'remove', provider: string, key?: string) {
  const r = await runWithStdin(inContainer(WRITE_JS, true), JSON.stringify({ action, provider, key }), 'user', 30_000);
  const out = safeJson<{ ok: boolean }>(r.stdout.trim().split('\n').pop() || '');
  if (!r.ok || !out?.ok) throw new MaintenanceError('No se pudo guardar la credencial en OpenBot', 503);
}

export function registerOpenBotProviders(app: Hono) {
  protect(app, '/api/openbot/providers');
  const fail = (c: any, e: unknown, fallback: string) => (e instanceof MaintenanceError ? e.getResponse() : c.json({ ok: false, error: fallback }, 503));

  app.get('/api/openbot/providers', async (c) => {
    try { return c.json({ ok: true, ...(await readProviders()) }); } catch (e) { return fail(c, e, 'No se pudieron leer los proveedores'); }
  });

  app.post('/api/openbot/providers/key', async (c) => {
    try {
      const b = await body(c); only(b, ['provider', 'key']);
      const provider = typeof b.provider === 'string' ? b.provider : '';
      const key = typeof b.key === 'string' ? b.key.trim() : '';
      if (!PROVIDER_ID.test(provider)) throw new MaintenanceError('Proveedor no válido', 400);
      if (!API_KEY.test(key)) throw new MaintenanceError('La clave no parece válida (8 a 600 caracteres, sin espacios)', 400);
      const known = (await readProviders()).addable.some((p) => p.id === provider);
      if (!known) throw new MaintenanceError('Ese proveedor no está en el catálogo de OpenCode', 400);
      await writeCredential('set', provider, key);
      return c.json({ ok: true, message: 'Clave guardada. Reiniciá OpenBot para que la app vea los modelos nuevos.' });
    } catch (e) { return fail(c, e, 'No se pudo guardar la clave'); }
  });

  app.post('/api/openbot/providers/remove', async (c) => {
    try {
      const b = await body(c); only(b, ['provider', 'confirm']);
      const provider = typeof b.provider === 'string' ? b.provider : '';
      if (!PROVIDER_ID.test(provider)) throw new MaintenanceError('Proveedor no válido', 400);
      if (b.confirm !== true) throw new MaintenanceError('Falta la confirmación', 400);
      await writeCredential('remove', provider);
      return c.json({ ok: true, message: 'Credencial quitada. Reiniciá OpenBot para aplicar.' });
    } catch (e) { return fail(c, e, 'No se pudo quitar la credencial'); }
  });

  // Llamada mínima (unos pocos tokens) para comprobar que la clave responde.
  app.post('/api/openbot/providers/test', async (c) => {
    try {
      const b = await body(c); only(b, ['provider']);
      const provider = typeof b.provider === 'string' ? b.provider : '';
      if (!PROVIDER_ID.test(provider)) throw new MaintenanceError('Proveedor no válido', 400);
      const list = await sh(`docker exec -e HOME=/data ${CONTAINER} sh -c ${q(`${OPENCODE_BIN}; $B models ${provider} 2>/dev/null`)}`, 40_000);
      const model = pickTestModel(clean(list.stdout).split('\n').map((l) => l.trim()).filter((l) => l.startsWith(provider + '/')));
      if (!model) throw new MaintenanceError('Ese proveedor no tiene modelos disponibles con la credencial actual', 409);
      const t0 = Date.now();
      const run = await sh(`docker exec -e HOME=/data ${CONTAINER} sh -c ${q(`${OPENCODE_BIN}; cd /tmp && timeout 80 $B run -m ${q(model)} 'Responde solo: ok'`)}`, 95_000);
      const reply = clean(run.stdout).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('>')).pop() || '';
      return c.json({ ok: true, works: run.ok && reply.length > 0, model, reply: reply.slice(0, 80), ms: Date.now() - t0, detail: run.ok ? '' : lastLines(run.stdout + run.stderr) });
    } catch (e) { return fail(c, e, 'No se pudo probar el proveedor'); }
  });
}
