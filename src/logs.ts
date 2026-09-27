import { randomUUID } from 'crypto';
import type { Hono } from 'hono';
import { hostExec, hostSpawn } from './host';

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

export interface LogsWsData {
  kind: 'logs';
  proc?: unknown;
  src: string;
  marker?: string;
}

interface ParsedLogsSrc {
  ok: boolean;
  cmd?: string;
  user?: 'root' | 'user';
  error?: string;
}

const UNIT_RE = /^[a-zA-Z0-9_.@-]{1,128}$/;
const DOCKER_ID_RE = /^[a-zA-Z0-9_.-]{1,128}$/;
// Absolute host paths — conservative printable set, spaces allowed.
const FILE_PATH_RE = /^[a-zA-Z0-9_+=.,@%/:~\- ]+$/;

function parseLogsSrcFull(raw: string): ParsedLogsSrc {
  const src = (raw || '').trim();
  const i = src.indexOf(':');
  const kind = i < 0 ? src : src.slice(0, i);
  const rest = i < 0 ? '' : src.slice(i + 1);

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
    return { ok: true, user, cmd: `${env}journalctl ${scope}-u ${unit} -f -n 100 --no-pager -o cat` };
  }

  if (kind === 'docker') {
    if (!DOCKER_ID_RE.test(rest)) return { ok: false, error: 'Contenedor inválido' };
    return { ok: true, user: 'user', cmd: `docker logs -f --tail 100 ${rest}` };
  }

  if (kind === 'file') {
    if (!rest.startsWith('/') || rest.includes('..') || !FILE_PATH_RE.test(rest)) {
      return { ok: false, error: 'Ruta inválida' };
    }
    return { ok: true, user: 'user', cmd: `tail -F -n 100 "${rest}"` };
  }

  return { ok: false, error: 'Fuente desconocida — usá journal:, journal:sys:, docker: o file:' };
}

export function parseLogsSrc(raw: string): { ok: boolean; cmd?: string; error?: string } {
  const r = parseLogsSrcFull(raw);
  return { ok: r.ok, cmd: r.cmd, error: r.error };
}

export function startLogsSocket(ws: { send: (d: string | ArrayBuffer) => unknown; data: LogsWsData }): void {
  const parsed = parseLogsSrcFull(ws.data?.src || '');
  if (!parsed.ok || !parsed.cmd) {
    try { ws.send(`\n[fuente inválida — ${parsed.error || 'src vacío'}]\n`); } catch { /* closed */ }
    return;
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
  try { (data.proc as { kill(s?: string): void } | undefined)?.kill('SIGKILL'); } catch { /* gone */ }
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

export function registerLogsRoutes(app: Hono): void {
  app.get('/api/logs/sources', async (c) => {
    const res = await hostExec(
      "export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user list-units --type=service --no-legend --plain 2>/dev/null | awk '{print $1}'",
      { user: 'user', timeoutMs: 10_000 }
    );
    const units = res.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => /^[a-zA-Z0-9_.@-]{1,128}$/.test(s))
      .slice(0, 50);
    return c.json({ ok: true, units });
  });
}
