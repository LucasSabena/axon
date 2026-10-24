import type { Hono } from 'hono';
import { body, only, protect } from './storage/http';
import { MaintenanceError } from './storage/types';
import { CONTAINER, DIR, asRoot, clean, heavyBusy, homeDir, jobRunning, lastLines, q, safeJson, sh, sleep, startJob, waitReady, withHeavy } from './openbot-shared';
import { actionBusy, parseStatus, runAction } from './openbot';

/* Diagnóstico: junta una "foto" del estado (un solo comando al host), la evalúa con reglas puras y ofrece
 * reparaciones de una lista cerrada. Ninguna reparación acepta parámetros del navegador. */

export type Level = 'ok' | 'info' | 'warn' | 'bad';
export const FIXES = ['start', 'restart', 'recreate', 'repair-db', 'restore-session', 'fix-compose', 'disable-broken-providers', 'enable-timers', 'backup', 'update'] as const;
export type Fix = typeof FIXES[number];
export interface Finding { id: string; level: Level; title: string; detail: string; fix?: { id: Fix; label: string; confirm: string } }

export interface Snapshot {
  container: { exists: boolean; state?: string; health?: string | null; restarts?: number; startedAt?: string; image?: string };
  statusText: string;
  manualStop: boolean;
  composeHasRootMount: boolean;
  composeImage: string | null;
  diskPct: number | null;
  externalMounted: boolean | null;
  lastBackupAgeHours: number | null;
  sessionBackup: string | null;
  update: { result?: string; detail?: string; at?: string } | null;
  timers: Record<string, string>;
  providerErrors: number;
  startFailure: string | null;
  providerCount: number | null;
}

const LEVEL_ORDER: Record<Level, number> = { bad: 0, warn: 1, info: 2, ok: 3 };

export function evaluate(s: Snapshot): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);
  const st = parseStatus(s.statusText);
  const running = s.container.exists && s.container.state === 'running';

  if (!s.container.exists) add({ id: 'no-container', level: 'bad', title: 'El contenedor de OpenBot no existe', detail: 'Hay que crearlo de nuevo desde el compose. Los datos están a salvo en su volumen.', fix: { id: 'recreate', label: 'Crear contenedor', confirm: 'Se crea el contenedor de OpenBot con el compose actual. Los datos no se tocan.' } });
  else if (!running) {
    add({ id: 'stopped', level: s.manualStop ? 'warn' : 'bad', title: s.manualStop ? 'OpenBot está detenido (a mano)' : 'OpenBot está caído', detail: s.manualStop ? 'Lo detuviste vos; el vigilante no lo levanta.' : `Estado: ${s.container.state}. El vigilante lo levanta solo a los pocos minutos, o podés hacerlo ahora.`, fix: { id: 'start', label: 'Iniciar', confirm: 'Se inicia OpenBot.' } });
  }

  if (s.startFailure && /migration to version/i.test(s.startFailure)) {
    add({ id: 'migration', level: 'bad', title: 'Falló la migración de la base de datos', detail: `${s.startFailure}. Suele deberse a filas huérfanas; la reparación las corrige (con respaldo previo).`, fix: { id: 'repair-db', label: 'Reparar base', confirm: 'Se detiene OpenBot, se respalda la base, se corrigen las referencias huérfanas y se vuelve a iniciar.' } });
  } else if (s.startFailure) {
    add({ id: 'start-failure', level: 'bad', title: 'OpenBot falló al arrancar', detail: s.startFailure });
  }

  if (running && s.container.restarts && s.container.restarts >= 3 && s.container.startedAt && Date.now() - Date.parse(s.container.startedAt) < 15 * 60_000 && !s.startFailure) {
    add({ id: 'restart-loop', level: 'warn', title: 'OpenBot se reinició varias veces', detail: `${s.container.restarts} reinicios. Mirá los registros para ver la causa.` });
  }
  if (running && s.container.health && s.container.health !== 'healthy' && s.container.health !== 'starting') {
    add({ id: 'unhealthy', level: 'bad', title: 'OpenBot no responde (unhealthy)', detail: 'El vigilante lo reinicia solo tras varios fallos.', fix: { id: 'restart', label: 'Reiniciar', confirm: 'Se reinicia OpenBot.' } });
  }

  if (running && !st.signedIn) {
    add({ id: 'signed-out', level: 'bad', title: 'OpenBot no tiene sesión iniciada', detail: s.sessionBackup ? 'Podés iniciar sesión desde Resumen, o restaurar el último respaldo que tenía la sesión abierta (se pierde lo posterior a ese respaldo).' : 'Iniciá sesión desde Resumen: te llega un código por email.', ...(s.sessionBackup ? { fix: { id: 'restore-session' as Fix, label: 'Restaurar respaldo con sesión', confirm: `Se restaura el respaldo ${s.sessionBackup} (antes se guarda una copia del estado actual). Los cambios posteriores a ese respaldo se pierden.` } } : {}) });
  } else if (running && st.signedIn && !st.online) {
    add({ id: 'offline', level: 'warn', title: 'Hay sesión pero el servidor no figura en línea', detail: st.server || 'Puede estar conectándose; si sigue así, reiniciá.', fix: { id: 'restart', label: 'Reiniciar', confirm: 'Se reinicia OpenBot.' } });
  }

  if (s.composeHasRootMount) {
    add({ id: 'root-mount', level: 'bad', title: 'El compose monta "/" en /host', detail: 'Eso rompe el llavero de OpenBot: la sesión se pierde en cada reinicio. El acceso al host ya está cubierto por docker.sock y las carpetas montadas.', fix: { id: 'fix-compose', label: 'Quitar el montaje', confirm: 'Se quita la línea "/:/host" del compose (con copia) y se recrea el contenedor. La sesión se conserva.' } });
  }
  if (s.providerErrors > 0) {
    add({ id: 'provider-errors', level: 'warn', title: 'Hay proveedores en error', detail: 'Un proveedor roto hace fallar la lista de modelos completa en la app ("La solicitud falló").', fix: { id: 'disable-broken-providers', label: 'Apagar proveedores rotos', confirm: 'Se apagan Codex y Claude (no incluidos en este build) y se reinicia OpenBot.' } });
  }
  if (s.providerCount === 0) add({ id: 'no-providers', level: 'info', title: 'Sin proveedores propios', detail: 'Solo están los modelos gratuitos. Agregá tu clave (p. ej. OpenCode Go) en la pestaña Proveedores.' });

  if (s.lastBackupAgeHours === null) add({ id: 'no-backup', level: 'warn', title: 'No hay respaldos', detail: 'Hacé uno ahora.', fix: { id: 'backup', label: 'Backup ahora', confirm: 'OpenBot se detiene aproximadamente un minuto mientras se copia.' } });
  else if (s.lastBackupAgeHours > 36) add({ id: 'old-backup', level: 'warn', title: 'El último respaldo es viejo', detail: `Tiene ${Math.round(s.lastBackupAgeHours)} horas; debería hacerse uno por día.`, fix: { id: 'backup', label: 'Backup ahora', confirm: 'OpenBot se detiene aproximadamente un minuto mientras se copia.' } });
  if (s.externalMounted === false) add({ id: 'no-external', level: 'warn', title: 'Disco externo de respaldos no montado', detail: 'Los respaldos solo quedan en el disco interno hasta que se vuelva a conectar /mnt/DATOS.' });

  if (s.diskPct !== null && s.diskPct >= 90) add({ id: 'disk-full', level: 'bad', title: `Disco casi lleno (${s.diskPct}%)`, detail: 'Con el disco lleno OpenBot y los respaldos fallan.' });
  else if (s.diskPct !== null && s.diskPct >= 80) add({ id: 'disk-high', level: 'warn', title: `Disco con ${s.diskPct}% de uso`, detail: 'Conviene liberar espacio pronto.' });
  const mem = st.memory?.match(/^(\d+)\s*MiB free/);
  if (mem && Number(mem[1]) < 1000) add({ id: 'low-memory', level: 'warn', title: 'Poca memoria libre para OpenBot', detail: st.memory || '' });

  const bad = ['failed', 'rolledback', 'broken', 'rejected'];
  if (s.update && s.update.result && bad.includes(s.update.result)) add({ id: 'update-failed', level: s.update.result === 'broken' ? 'bad' : 'warn', title: 'La última actualización no se aplicó', detail: s.update.detail || s.update.result, fix: { id: 'update', label: 'Reintentar', confirm: 'Se busca de nuevo una actualización (backup, prueba en copia y recién entonces se aplica).' } });
  const missing = Object.entries(s.timers).filter(([, v]) => v !== 'enabled').map(([k]) => k);
  if (missing.length) add({ id: 'timers', level: 'warn', title: 'Hay tareas automáticas apagadas', detail: missing.join(', '), fix: { id: 'enable-timers', label: 'Activar', confirm: 'Se activan las tareas automáticas de OpenBot (actualización, respaldo y vigilante).' } });

  if (!out.some((f) => f.level === 'bad' || f.level === 'warn')) add({ id: 'all-good', level: 'ok', title: 'Todo en orden', detail: 'OpenBot está corriendo, con sesión, respaldos al día y tareas automáticas activas.' });
  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

// ---------------------------------------------------------------- foto del estado
const ENV = 'XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus';
const SNAP_CMD = [
  `docker inspect ${CONTAINER} --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.StartedAt}}|{{.Config.Image}}' 2>/dev/null || echo missing`,
  `echo '@@STATUS'; timeout 20 docker exec ${CONTAINER} openbot status 2>&1`,
  `echo '@@FLAGS'; test -e ${DIR}/state/manual-stop && echo manual; grep -Eq '^[[:space:]]*-[[:space:]]*/:/host' ${DIR}/compose.yaml && echo rootmount; grep -oE 'image: [^ ]+' ${DIR}/compose.yaml | head -n 1`,
  `echo '@@DISK'; df -P / | awk 'NR==2{gsub("%","",$5); print $5}'; (findmnt -T /mnt/DATOS -n -o TARGET 2>/dev/null | grep -q '^/mnt/DATOS$' && echo mounted || echo unmounted)`,
  `echo '@@BACKUPS'; for d in $(ls -1d ${DIR}/backups/2* 2>/dev/null | tail -n 1); do stat -c %Y "$d/data.tar.gz" 2>/dev/null; done; date +%s`,
  `echo '@@UPDATE'; cat ${DIR}/state/update-status.json 2>/dev/null`,
  `echo '@@TIMERS'; for t in openbot-update openbot-backup openbot-watchdog; do echo "$t $(${ENV} systemctl --user is-enabled $t.timer 2>/dev/null || echo off)"; done`,
  `echo '@@LOGS'; docker logs --since 15m ${CONTAINER} 2>&1 | grep -c '"to":"error"'; docker logs --since 15m ${CONTAINER} 2>&1 | grep 'failed to start' | tail -n 1 | grep -o '"message":"[^"]*"' | head -n 1`,
  `echo '@@PROVIDERS'; docker exec -e HOME=/data ${CONTAINER} sh -c 'test -f /data/.local/share/opencode/auth.json && grep -c "\\"type\\"" /data/.local/share/opencode/auth.json || echo 0'`,
].join('; ');

export function parseSnapshot(raw: string): Snapshot {
  const parts = raw.split(/^@@(\w+)$/m);
  const sec: Record<string, string> = { HEAD: parts[0] };
  for (let i = 1; i < parts.length; i += 2) sec[parts[i]] = (parts[i + 1] || '').replace(/^\n/, '');
  const head = sec.HEAD.trim().split('\n')[0] || 'missing';
  const [state, health, restarts, startedAt, image] = head.split('|');
  const flags = sec.FLAGS || '';
  const disk = (sec.DISK || '').trim().split('\n');
  const bk = (sec.BACKUPS || '').trim().split('\n').map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const timers: Record<string, string> = {};
  for (const l of (sec.TIMERS || '').trim().split('\n')) { const [k, v] = l.trim().split(/\s+/); if (k) timers[k] = v || 'off'; }
  const logs = (sec.LOGS || '').trim().split('\n');
  const msg = logs.find((l) => l.startsWith('"message"'));
  return {
    container: head === 'missing' ? { exists: false } : { exists: true, state, health: health || null, restarts: Number(restarts) || 0, startedAt, image },
    statusText: sec.STATUS || '',
    manualStop: /^manual$/m.test(flags),
    composeHasRootMount: /^rootmount$/m.test(flags),
    composeImage: flags.match(/image: (\S+)/)?.[1] ?? null,
    diskPct: Number.isFinite(Number(disk[0])) && disk[0] !== '' ? Number(disk[0]) : null,
    externalMounted: disk[1] ? disk[1].trim() === 'mounted' : null,
    lastBackupAgeHours: bk.length >= 2 ? Math.max(0, (bk[bk.length - 1] - bk[0]) / 3600) : null,
    sessionBackup: null,
    update: safeJson((sec.UPDATE || '').trim()),
    timers,
    providerErrors: Number((logs[0] || '0').trim()) || 0,
    startFailure: msg ? msg.replace(/^"message":"/, '').replace(/"$/, '').slice(0, 200) : null,
    providerCount: Number.isFinite(Number((sec.PROVIDERS || '').trim())) ? Number((sec.PROVIDERS || '').trim()) : null,
  };
}

/** Respaldo más reciente cuyo contenido incluye el archivo de sesión (se mira a lo sumo en los 6 más nuevos). */
async function findSessionBackup(): Promise<string | null> {
  const r = await sh(`cd ${DIR}/backups 2>/dev/null || exit 0; for d in $(ls -1d 2* 2>/dev/null | sort -r | head -n 6); do if tar tzf "$d/data.tar.gz" 2>/dev/null | grep -q 'openbot-central-auth-v1.bin'; then echo "$d"; break; fi; done`, 90_000);
  const name = r.stdout.trim().split('\n').pop() || '';
  return /^\d{8}T\d{6}Z$/.test(name) ? name : null;
}

export async function takeSnapshot(withBackups = true): Promise<Snapshot> {
  const r = await sh(SNAP_CMD, 60_000);
  const snap = parseSnapshot(r.stdout);
  if (withBackups && snap.container.exists && !parseStatus(snap.statusText).signedIn) snap.sessionBackup = await findSessionBackup();
  return snap;
}

// ---------------------------------------------------------------- reparaciones
const FK_PY = String.raw`
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("pragma wal_checkpoint(truncate)")
db.execute("update projection_turns set provider_session_id = null where provider_session_id is not null and provider_session_id not in (select id from projection_provider_sessions)")
left = db.execute("select count(*) from pragma_foreign_key_check").fetchone()[0]
db.commit(); db.close()
print(json.dumps(dict(ok=True, remaining=left)))
`;
const b64 = (s: string) => Buffer.from(s).toString('base64');

async function volumePath(): Promise<string> {
  const v = (await sh(`docker volume inspect openbot-data --format '{{.Mountpoint}}'`, 20_000)).stdout.trim();
  if (!/^\/[\w./-]+\/openbot-data\/_data$/.test(v)) throw new MaintenanceError('No se encontró el volumen de datos de OpenBot', 503);
  return v;
}
const stopBot = () => sh(`set -e; cd ${DIR}; mkdir -p state; touch state/manual-stop; docker stop -t 60 ${CONTAINER} >/dev/null`, 110_000);
const startBot = () => sh(`cd ${DIR}; rm -f state/manual-stop; docker start ${CONTAINER} >/dev/null 2>&1`, 40_000);

async function repairDb() {
  return withHeavy('reparar base', 15 * 60_000, async () => {
    const home = await homeDir(); const stop = await stopBot();
    if (!stop.ok) { await startBot(); throw new MaintenanceError('No se pudo detener OpenBot', 503); }
    let err: string | null = null; let remaining = -1;
    try {
      const db = `${await volumePath()}/.config/OpenBot/openbot.db`;
      const bk = await asRoot(`set -e; mkdir -p ${q(home + '/openbot-server/state/db-backups')}; chmod 700 ${q(home + '/openbot-server/state/db-backups')}; cp -p ${q(db)} ${q(`${home}/openbot-server/state/db-backups/openbot.db.${Date.now()}`)}; ls -1t ${q(home + '/openbot-server/state/db-backups')} | tail -n +4 | while read f; do rm -f ${q(home + '/openbot-server/state/db-backups')}/"$f"; done`, 120_000);
      if (!bk.ok) throw new Error('No se pudo respaldar la base');
      const run = await asRoot(`S=$(mktemp); echo ${b64(FK_PY)} | base64 -d > "$S"; python3 "$S" ${q(db)}; rc=$?; rm -f "$S"; chown 1000:1000 ${q(db)}* 2>/dev/null; exit $rc`, 120_000);
      const out = safeJson<{ ok: boolean; remaining: number }>(run.stdout.trim().split('\n').pop() || '');
      if (!out?.ok) throw new Error('La reparación no terminó bien'); remaining = out.remaining;
    } catch (e) { err = e instanceof Error ? e.message : 'Error'; }
    await startBot(); const up = await waitReady(150);
    if (err) throw new MaintenanceError(err, 503);
    return { message: remaining === 0 ? `Base reparada y OpenBot ${up ? 'volvió a arrancar' : 'iniciado (todavía arrancando)'}.` : `Se corrigió lo posible pero quedan ${remaining} problemas de integridad.` };
  });
}

async function restoreSession() {
  const name = await findSessionBackup();
  if (!name) throw new MaintenanceError('No hay ningún respaldo que tenga la sesión abierta', 404);
  return withHeavy('restaurar sesión', 20 * 60_000, async () => {
    const home = await homeDir(); const root = `${home}/openbot-server/backups`;
    const stop = await stopBot();
    if (!stop.ok) { await startBot(); throw new MaintenanceError('No se pudo detener OpenBot', 503); }
    let err: string | null = null;
    try {
      const safe = `${root}/pre-restore-${Date.now()}`;
      const copy = await sh(`set -e; mkdir -p ${q(safe)}; docker run --rm -v openbot-data:/source:ro -v ${q(safe)}:/backup alpine tar czf /backup/data.tar.gz -C /source .`, 600_000);
      if (!copy.ok) throw new Error('No se pudo guardar una copia del estado actual');
      const res = await sh(`set -e; docker run --rm -v openbot-data:/data -v ${q(`${root}/${name}`)}:/in:ro alpine sh -c 'find /data -mindepth 1 -delete; tar xzf /in/data.tar.gz -C /data'`, 600_000);
      if (!res.ok) throw new Error('Falló la restauración del respaldo');
    } catch (e) { err = e instanceof Error ? e.message : 'Error'; }
    await startBot(); const up = await waitReady(180);
    if (err) throw new MaintenanceError(err, 503);
    return { message: `Se restauró el respaldo ${name}${up ? ' y OpenBot volvió a arrancar' : ''}.` };
  });
}

async function fixCompose() {
  return withHeavy('corregir compose', 10 * 60_000, async () => {
    const r = await sh(`set -e; cd ${DIR}; mkdir -p state; cp compose.yaml state/compose.yaml.before-fix-$(date +%s); sed -i '/^[[:space:]]*-[[:space:]]*\\/:\\/host[[:space:]]*$/d' compose.yaml; ! grep -Eq '^[[:space:]]*-[[:space:]]*/:/host' compose.yaml; docker compose up -d --force-recreate >/dev/null 2>&1`, 200_000);
    if (!r.ok) throw new MaintenanceError('No se pudo corregir el compose', 503);
    const up = await waitReady(150);
    return { message: up ? 'Montaje quitado y OpenBot recreado. La sesión se conserva.' : 'Montaje quitado; OpenBot sigue arrancando.' };
  });
}

async function disableBroken() {
  return withHeavy('apagar proveedores', 10 * 60_000, async () => {
    const r = await sh(`cd ${DIR} && ./bin/disable-broken-providers.sh`, 90_000);
    if (!r.ok) throw new MaintenanceError(`No se pudo apagar los proveedores: ${lastLines(r.stdout + r.stderr)}`, 503);
    await sh(`docker restart -t 60 ${CONTAINER}`, 100_000);
    return { message: 'Proveedores rotos apagados y OpenBot reiniciado.' };
  });
}

async function enableTimers() {
  const r = await sh(`${ENV} systemctl --user enable --now openbot-update.timer openbot-backup.timer openbot-watchdog.timer 2>&1`, 30_000);
  if (!r.ok) throw new MaintenanceError(`No se pudieron activar: ${lastLines(r.stdout + r.stderr)}`, 503);
  return { message: 'Tareas automáticas activadas.' };
}

export async function runFix(fix: Fix): Promise<{ message: string }> {
  switch (fix) {
    case 'start': { const r = await runAction('start'); return { message: r.message }; }
    case 'restart': { const r = await runAction('restart'); return { message: r.message }; }
    case 'backup': { const r = await runAction('backup'); return { message: r.message }; }
    case 'update': { const r = await runAction('update'); return { message: r.message }; }
    case 'recreate': { const r = await sh(`cd ${DIR} && rm -f state/manual-stop; docker compose up -d`, 150_000); if (!r.ok) throw new MaintenanceError('No se pudo crear el contenedor', 503); await sleep(2000); return { message: 'Contenedor creado.' }; }
    case 'repair-db': return repairDb();
    case 'restore-session': return restoreSession();
    case 'fix-compose': return fixCompose();
    case 'disable-broken-providers': return disableBroken();
    case 'enable-timers': return enableTimers();
  }
}

export function registerOpenBotDoctor(app: Hono) {
  protect(app, '/api/openbot/doctor');
  const fail = (c: any, e: unknown, fallback: string) => (e instanceof MaintenanceError ? e.getResponse() : c.json({ ok: false, error: fallback }, 503));

  app.get('/api/openbot/doctor', async (c) => {
    try { const snap = await takeSnapshot(); return c.json({ ok: true, findings: evaluate(snap), checkedAt: new Date().toISOString(), running: heavyBusy() || actionBusy() || null }); }
    catch (e) { return fail(c, e, 'No se pudo hacer el diagnóstico'); }
  });

  app.post('/api/openbot/doctor/fix', async (c) => {
    try {
      const b = await body(c); only(b, ['fix', 'confirm']);
      if (typeof b.fix !== 'string' || !(FIXES as readonly string[]).includes(b.fix)) throw new MaintenanceError('Reparación no válida', 400);
      if (b.confirm !== true) throw new MaintenanceError('Falta la confirmación', 400);
      const fix = b.fix as Fix;
      const busy = actionBusy() || heavyBusy();
      if (busy || jobRunning()) throw new MaintenanceError(`Hay otra operación en curso (${busy || 'tarea'}). Esperá a que termine.`, 409);
      return c.json({ ok: true, started: true, job: startJob(`Reparación: ${fix}`, () => runFix(fix)) });
    } catch (e) { return fail(c, e, 'No se pudo aplicar la reparación'); }
  });
  void clean;
}
