import { randomUUID } from 'crypto';
import type { Hono } from 'hono';
import { hostExec, hostSpawn, killHostProc, HOST_USER } from './host';
import { recordEvent } from './events';

// ---------- Live log streaming over WebSocket ----------
// One spawned tailer per socket. The spawned chain (nsenter → runuser →
// bash -lc) ends in `exec <cmd>`, which collapses the whole thing into a
// single host process — proc.kill() therefore tears it down directly.
// Each command also embeds a unique PMLOG=<uuid> marker so stopLogsSocket
// can sweep stragglers targeted-ly if any layer ever forks (runuser/su):
//   - pkill -f hits wrappers whose argv still contains the marker text
//   - an /proc/<pid>/environ scan hits the exec'd leaf (env survives exec)
// The marker is never written contiguously into the sweep command's own
// argv, so the sweep can't match itself.
//
// src grammar: `<kind>:<arg>` optionally followed by `||<json>` with
// server-side filters — {since, grep, invert, icase, priority, lines,
// follow:false}. `||` can't appear inside any legit arg (paths/units/
// container names reject `|`), so the split is unambiguous.

export interface LogsWsData {
  kind: 'logs';
  proc?: unknown;
  src: string;
  marker?: string;
}

type SrcKind = 'journal' | 'docker' | 'file';

interface ParsedLogsSrc {
  ok: boolean;
  kind?: SrcKind;
  cmd?: string;
  user?: 'root' | 'user';
  error?: string;
}

interface LogOpts {
  since?: string;
  grep?: string;
  invert?: boolean;
  icase?: boolean;
  priority?: string;
  lines?: number;
  follow?: boolean;
}

const UNIT_RE = /^[a-zA-Z0-9_.@-]{1,128}$/;
const DOCKER_ID_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/;
// Absolute host paths — conservative printable set, spaces allowed.
const FILE_PATH_RE = /^[a-zA-Z0-9_+=.,@%/:~\- ]+$/;
// journalctl --since / docker --since accept free-form timespecs ("1h",
// "2024-01-01 10:00", "yesterday") — bound charset + length, then shq.
const SINCE_RE = /^[0-9A-Za-z:.,+_\- ]{1,64}$/;
const PRIORITY_RE = /^(emerg|alert|crit|err|warning|notice|info|debug|[0-7])$/;
const USER_NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

// POSIX single-quote escaping: 'foo'bar' -> 'foo'"'"'bar'.
const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

// `file:` is confined to a short list of known log roots — anything else is
// arbitrary file read as the host user (~/.ssh, .env, etc). The static
// prefix check rejects early; the resolved path is re-checked with realpath
// inside the spawned command so symlinks can't escape the roots.
function fileRoots(): string[] {
  const home = USER_NAME_RE.test(HOST_USER) && HOST_USER !== 'root' ? `/home/${HOST_USER}` : '/root';
  return ['/var/log', (process.env.HOST_LOG_DIR || '/tmp/pm-logs').replace(/\/+$/, ''), `${home}/.pm2/logs`];
}

export function fileRootHints(): string[] {
  return ['/var/log/', `${(process.env.HOST_LOG_DIR || '/tmp/pm-logs').replace(/\/+$/, '')}/`, '~/.pm2/logs/'];
}

function parseOpts(raw: string): { opts: LogOpts; error?: string } {
  if (!raw) return { opts: {} };
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw); } catch { return { opts: {}, error: 'Opciones inválidas' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { opts: {}, error: 'Opciones inválidas' };
  const opts: LogOpts = {};
  if (j.since !== undefined) {
    if (typeof j.since !== 'string' || !SINCE_RE.test(j.since)) return { opts, error: 'Filtro "desde" inválido' };
    opts.since = j.since;
  }
  if (j.grep !== undefined) {
    if (typeof j.grep !== 'string' || !j.grep.length || j.grep.length > 200 || /[\u0000-\u001f]/.test(j.grep)) {
      return { opts, error: 'Filtro de texto inválido' };
    }
    opts.grep = j.grep;
  }
  if (j.invert !== undefined) opts.invert = j.invert === true;
  if (j.icase !== undefined) opts.icase = j.icase === true;
  if (j.priority !== undefined) {
    if (typeof j.priority !== 'string' || !PRIORITY_RE.test(j.priority)) return { opts, error: 'Severidad inválida' };
    opts.priority = j.priority;
  }
  if (j.lines !== undefined) {
    const n = Math.trunc(Number(j.lines));
    if (!Number.isFinite(n) || n < 1 || n > 2000) return { opts, error: 'Cantidad de líneas inválida' };
    opts.lines = n;
  }
  if (j.follow !== undefined) opts.follow = j.follow !== false;
  return { opts };
}

// Trailing `| grep --line-buffered` filter, shared by all sources.
function grepPipe(opts: LogOpts): string {
  if (!opts.grep) return '';
  const flags = `${opts.invert ? 'v' : ''}${opts.icase ? 'i' : ''}`;
  return ` | grep -E --line-buffered ${flags ? `-${flags} ` : ''}-- ${shq(opts.grep)}`;
}

function parseLogsSrcFull(raw: string): ParsedLogsSrc {
  const src = (raw || '').trim();
  const sep = src.indexOf('||');
  const spec = sep < 0 ? src : src.slice(0, sep);
  const { opts, error: optErr } = parseOpts(sep < 0 ? '' : src.slice(sep + 2));
  if (optErr) return { ok: false, error: optErr };
  const follow = opts.follow !== false;
  const lines = opts.lines ?? 100;

  const i = spec.indexOf(':');
  const kind = i < 0 ? spec : spec.slice(0, i);
  const rest = i < 0 ? '' : spec.slice(i + 1);

  if (kind === 'journal') {
    // journal:<unit> → user journal; journal:sys:<unit> → system journal (root)
    let user: 'root' | 'user' = 'user';
    let unit = rest;
    if (rest.startsWith('sys:')) {
      user = 'root';
      unit = rest.slice(4);
    }
    if (!UNIT_RE.test(unit)) return { ok: false, error: 'Unidad inválida' };
    const scope = user === 'root' ? '' : '--user ';
    const env = user === 'root' ? '' : 'XDG_RUNTIME_DIR=/run/user/$(id -u) ';
    const filters =
      `${opts.since ? ` --since ${shq(opts.since)}` : ''}` +
      `${opts.priority ? ` -p ${opts.priority}` : ''}`;
    const cmd = `${env}journalctl ${scope}-u ${unit} ${follow ? '-f ' : ''}-n ${lines} --no-pager -o short-iso${filters}${grepPipe(opts)}`;
    return { ok: true, kind: 'journal', user, cmd };
  }

  if (kind === 'docker') {
    if (!DOCKER_ID_RE.test(rest)) return { ok: false, error: 'Contenedor inválido' };
    const cmd = `docker logs ${follow ? '-f ' : ''}--timestamps --tail ${lines}${opts.since ? ` --since ${shq(opts.since)}` : ''} ${rest}${grepPipe(opts)}`;
    return { ok: true, kind: 'docker', user: 'user', cmd };
  }

  if (kind === 'file') {
    const roots = fileRoots();
    if (
      !rest.startsWith('/') || rest.includes('..') || !FILE_PATH_RE.test(rest) ||
      !roots.some((r) => rest.startsWith(`${r}/`))
    ) {
      return { ok: false, error: `Ruta fuera de los directorios permitidos (${fileRootHints().join(', ')})` };
    }
    // realpath re-check inside the spawned shell: a symlink inside an allowed
    // root pointing outside resolves to a denied prefix before tail opens it.
    const pat = roots.map((r) => `${shq(r)}/*`).concat(['"$HOME"/.pm2/logs/*']).join('|');
    const guard =
      `P=${shq(rest)}; R="$(realpath -m -- "$P" 2>/dev/null)" || exit 1; ` +
      `case "$R" in ${pat}) ;; *) echo "[ruta fuera de los directorios permitidos]" >&2; exit 1;; esac; `;
    const tail = follow ? `tail -F -n ${lines}` : `tail -n ${lines}`;
    return { ok: true, kind: 'file', user: 'user', cmd: `${guard}exec ${tail} -- "$P"${grepPipe(opts)}` };
  }

  return { ok: false, error: 'Fuente desconocida — usá journal:, journal:sys:, docker: o file:' };
}

export function parseLogsSrc(raw: string): { ok: boolean; cmd?: string; error?: string } {
  const r = parseLogsSrcFull(raw);
  // Upgrade-time gate (index.ts): a denied file: never reaches
  // startLogsSocket, so the denial is audited here — exactly once per
  // rejected attempt.
  if (!r.ok && raw?.trim().startsWith('file:')) {
    recordEvent('file', 'Acceso a log por archivo rechazado', raw.trim().slice(0, 200));
  }
  return { ok: r.ok, cmd: r.cmd, error: r.error };
}

export function startLogsSocket(ws: { send: (d: string | ArrayBuffer) => unknown; data: LogsWsData }): void {
  const parsed = parseLogsSrcFull(ws.data?.src || '');
  if (!parsed.ok || !parsed.cmd) {
    try { ws.send(`\n[fuente inválida — ${parsed.error || 'src vacío'}]\n`); } catch { /* closed */ }
    return;
  }
  if (parsed.kind === 'file') {
    const spec = (ws.data.src || '').split('||')[0];
    recordEvent('file', 'Streaming de archivo de log iniciado', spec.slice(5, 205));
  }
  const marker = `PMLOG=${randomUUID()}`;
  ws.data.marker = marker;
  const proc = hostSpawn(`export TERM=dumb ${marker}; exec ${parsed.cmd}`, { user: parsed.user });
  ws.data.proc = proc;
  const pump = async (stream: ReadableStream<Uint8Array> | undefined) => {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        try {
          ws.send(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer);
        } catch { break; }
      }
    } catch { /* closed */ }
  };
  pump(proc.stdout as ReadableStream<Uint8Array>);
  pump(proc.stderr as ReadableStream<Uint8Array>);
  proc.exited.then((code: number) => {
    try { ws.send(`\n[log terminado — exit ${code}]\n`); } catch { /* closed */ }
  });
}

export function stopLogsSocket(data: LogsWsData): void {
  try { if (data.proc) killHostProc(data.proc as Parameters<typeof killHostProc>[0]); } catch { /* gone */ }
  const marker = data.marker;
  if (!marker) return;
  // Build the literal "PMLOG=<uuid>" inside the sweep's own shell so the
  // sweep command never contains it contiguously — it can't kill itself.
  const uuid = marker.slice(marker.indexOf('=') + 1);
  hostExec(
    `M="PMLOG="; M="\${M}${uuid}"; ` +
    `pkill -9 -f "$M" 2>/dev/null; ` +
    `for d in /proc/[0-9]*/environ; do ` +
    `  if tr '\\0' '\\n' < "$d" 2>/dev/null | grep -qxF "$M"; then ` +
    `    kill -9 "$(basename "$(dirname "$d")")" 2>/dev/null; ` +
    `  fi; ` +
    `done; true`,
    { timeoutMs: 10_000 }
  ).catch(() => {});
}

// ---------- Sources picker feed ----------

const UNIT_PICK_RE = /^[a-zA-Z0-9_.@-]{1,128}$/;

export function registerLogsRoutes(app: Hono): void {
  app.get('/api/logs/sources', async (c) => {
    const pick = (out: string, cap: number) =>
      out.split('\n').map((s) => s.trim()).filter((s) => UNIT_PICK_RE.test(s)).slice(0, cap);
    const [userRes, sysRes] = await Promise.all([
      hostExec(
        "export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user list-units --type=service --no-legend --plain 2>/dev/null | awk '{print $1}'",
        { user: 'user', timeoutMs: 10_000 }
      ),
      hostExec(
        "systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}'",
        { timeoutMs: 10_000 }
      ),
    ]);
    return c.json({
      ok: true,
      units: pick(userRes.stdout, 50),
      systemUnits: pick(sysRes.stdout, 80),
      fileRoots: fileRootHints(),
    });
  });

  // Preflight so the UI can surface a rejection reason before opening the WS
  // (an upgrade denied with 400 carries no message to the socket). A file:
  // denied here never reaches parseLogsSrc at upgrade time — audit it too.
  app.get('/api/logs/check', (c) => {
    const src = c.req.query('src') || '';
    const r = parseLogsSrcFull(src);
    if (!r.ok && src.trim().startsWith('file:')) {
      recordEvent('file', 'Acceso a log por archivo rechazado', src.trim().slice(0, 200));
    }
    return c.json({ ok: r.ok, error: r.error });
  });
}
