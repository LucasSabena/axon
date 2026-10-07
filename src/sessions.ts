import type { Context, Hono } from 'hono';
import { chmod, mkdir, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';

// ---------- Session / device registry ----------
// Session tokens are stateless signed `base64(payload).sig` cookies
// (src/auth.ts), so revocation needs a denylist + a registry of issued tokens.
// Persisted in data/sessions.json: { issued: [...], revoked: [...] }.
//
// A "session id" is the token's `jti` claim. Tokens minted before jti existed
// get a stable derived id: `tok-<sha256(token)>` — revoking that id kills
// exactly that token. Use sessionIdForToken()/sessionIdFromRequest() at every
// call site so both cases are handled identically.

export interface IssuedSession {
  jti: string;       // jti claim, or `tok-<hash>` for legacy tokens
  username: string;
  ua: string;
  created: number;   // epoch ms
  lastSeen: number;  // epoch ms
}

const FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'sessions.json'
);

// Tokens live 7 days (auth.ts createSession); entries older than that are dead.
const ISSUED_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const REVOKED_CAP = 2000;
const SAVE_DEBOUNCE_MS = 4000;

const issued = new Map<string, IssuedSession>();
// jti → epoch ms after which the underlying token is dead anyway. Keeping the
// expiry lets us prune the denylist without ever evicting a live revocation.
const revoked = new Map<string, number>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function loadSync(): void {
  try {
    const obj = JSON.parse(readFileSync(FILE, 'utf-8'));
    const cutoff = Date.now() - ISSUED_MAX_AGE_MS;
    for (const s of obj?.issued || []) {
      if (s && typeof s.jti === 'string' && Number.isFinite(s.created) && s.created > cutoff) {
        issued.set(s.jti, {
          jti: s.jti,
          username: String(s.username || ''),
          ua: String(s.ua || ''),
          created: s.created,
          lastSeen: Number.isFinite(s.lastSeen) ? s.lastSeen : s.created,
        });
      }
    }
    const now = Date.now();
    for (const r of obj?.revoked || []) {
      // Current files store { jti, exp }; legacy files had plain jti strings.
      if (typeof r === 'string' && r) {
        revoked.set(r, (issued.get(r)?.created ?? now) + ISSUED_MAX_AGE_MS);
      } else if (r && typeof r.jti === 'string' && r.jti && Number.isFinite(r.exp) && r.exp > now) {
        revoked.set(r.jti, r.exp);
      }
    }
  } catch { /* missing/corrupt — start fresh */ }
}
loadSync();

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeQueue = writeQueue.then(async () => {
      try {
        await mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
        await writeFile(
          FILE,
          JSON.stringify({ issued: [...issued.values()], revoked: [...revoked.entries()].map(([jti, exp]) => ({ jti, exp })) }, null, 1),
          { encoding: 'utf-8', mode: 0o600 }
        );
        // writeFile's mode only applies on creation — keep an older
        // world-readable sessions.json private too.
        await chmod(FILE, 0o600).catch(() => {});
      } catch { /* disk errors are non-fatal */ }
    });
  }, SAVE_DEBOUNCE_MS);
  (saveTimer as { unref?: () => void })?.unref?.();
}

function tokenHash(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex').slice(0, 32);
}

// Session id for a raw token: the `jti` claim when present (new format),
// otherwise a stable `tok-<hash>` of the whole token (legacy tokens).
export function sessionIdForToken(token: string): string | null {
  if (!token) return null;
  try {
    const body = token.split('.')[0];
    if (body) {
      const json = new TextDecoder().decode(
        Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0))
      );
      const payload = JSON.parse(json);
      if (payload && typeof payload.jti === 'string' && payload.jti) return payload.jti;
    }
  } catch { /* fall through to the hash fallback */ }
  return `tok-${tokenHash(token)}`;
}

// Read the axon_session cookie off a Hono context (or the auth.ts cookie name)
// and return its session id — one-liner for the integrator's middleware.
export function sessionIdFromRequest(c: Context): string | null {
  const cookie = c.req.header('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)axon_session=([^;]+)/);
  if (!m) return null;
  try {
    return sessionIdForToken(decodeURIComponent(m[1]));
  } catch {
    return sessionIdForToken(m[1]); // malformed % escape — use raw value
  }
}

// Accepts either a jti or a full token (legacy callers); normalizes to the id.
function normalizeId(jtiOrToken: string | null | undefined): string | null {
  if (!jtiOrToken) return null;
  if (jtiOrToken.includes('.')) return sessionIdForToken(jtiOrToken);
  return jtiOrToken;
}

// Record a freshly minted session. INTEGRATOR: call right after createSession()
// in /api/login and /pair — e.g.
//   recordSession(sessionIdForToken(token), username, c.req.header('user-agent'))
// Best long-term fix: add `jti: crypto.randomUUID()` to the payload in
// auth.ts createSession() so revoking doesn't depend on token hashing.
export function recordSession(jtiOrToken: string, username: string, ua: string): void {
  const jti = normalizeId(jtiOrToken);
  if (!jti) return;
  const now = Date.now();
  const existing = issued.get(jti);
  issued.set(jti, {
    jti,
    username: String(username || ''),
    ua: String(ua || '').slice(0, 300),
    created: existing?.created ?? now,
    lastSeen: now,
  });
  revoked.delete(jti); // a freshly recorded id must not stay denied
  saveSoon();
}

// Update lastSeen — call from the auth middleware on each request. The write
// is debounced so per-request cost is just a map write.
export function touchSession(jtiOrToken: string): void {
  const jti = normalizeId(jtiOrToken);
  if (!jti) return;
  const s = issued.get(jti);
  if (!s) return; // don't resurrect unknown/expired sessions
  const now = Date.now();
  if (now - s.lastSeen < 60_000) return; // cheap throttle: one bump per minute
  s.lastSeen = now;
  saveSoon();
}

// A deny entry only matters while its token could still verify: issued
// entries carry the mint time, anything else gets the full max age.
function revokedExpiry(jti: string): number {
  return (issued.get(jti)?.created ?? Date.now()) + ISSUED_MAX_AGE_MS;
}

// Drop deny entries whose token can't be valid anymore. A revocation for a
// jti absent from `issued` is NOT automatically stale — legacy tokens never
// entered the registry but can still be live.
function pruneRevoked(): void {
  const now = Date.now();
  for (const [jti, exp] of revoked) if (exp <= now) revoked.delete(jti);
}

function revokedHas(jti: string): boolean {
  const exp = revoked.get(jti);
  if (exp === undefined) return false;
  if (exp <= Date.now()) {
    revoked.delete(jti); // token can't be valid anymore — lazily prune
    return false;
  }
  return true;
}

export function revokeSession(jtiOrToken: string): void {
  const jti = normalizeId(jtiOrToken);
  if (!jti) return;
  if (revoked.size >= REVOKED_CAP) {
    // Only expired-token revocations may leave — evicting a live one would
    // silently un-revoke a still-valid session. If nothing is stale the set
    // grows past the cap; correctness beats the memory bound.
    pruneRevoked();
  }
  revoked.set(jti, revokedExpiry(jti));
  saveSoon();
}

export function isRevoked(jtiOrToken: string): boolean {
  const jti = normalizeId(jtiOrToken);
  return !!jti && revokedHas(jti);
}

// Drop entries older than the token lifetime — loadSync does this at boot,
// but during long uptimes the map would otherwise grow forever.
function pruneIssued(): void {
  const cutoff = Date.now() - ISSUED_MAX_AGE_MS;
  let dirty = false;
  for (const [jti, s] of issued) {
    if (s.created <= cutoff) {
      issued.delete(jti);
      dirty = true;
    }
  }
  if (dirty) saveSoon();
}

// issued sorted by lastSeen desc; revoked as a plain list. No token material.
export function listSessions(): { issued: IssuedSession[]; revoked: string[] } {
  pruneIssued();
  pruneRevoked();
  return {
    issued: [...issued.values()].sort((a, b) => b.lastSeen - a.lastSeen),
    revoked: [...revoked.keys()],
  };
}

function fail(c: Context, status: number, error: string) {
  return c.json({ ok: false, error }, status as never);
}

// INTEGRATOR: call AFTER app.use('/api/*', requireAuth) so these stay authed.
export function registerSessionRoutes(app: Hono): void {
  app.get('/api/sessions', (c) => {
    const current = sessionIdFromRequest(c);
    return c.json({
      ok: true,
      sessions: listSessions().issued.map((s) => ({
        jti: s.jti.slice(0, 12), // short prefix only — never token material
        username: s.username,
        ua: s.ua,
        created: s.created,
        lastSeen: s.lastSeen,
        revoked: revokedHas(s.jti),
        current: s.jti === current,
      })),
    });
  });

  // Registered before /:jti/revoke so 'revoke-others' isn't eaten by :jti.
  app.post('/api/sessions/revoke-others', (c) => {
    const current = sessionIdFromRequest(c);
    if (!current) {
      // Old-format token we can't tie to a registry entry — do nothing, don't fail.
      return c.json({ ok: true, revoked: 0, note: 'No se pudo identificar la sesión actual' });
    }
    pruneIssued();
    let n = 0;
    for (const s of issued.values()) {
      if (s.jti !== current && !revokedHas(s.jti)) {
        revokeSession(s.jti);
        n++;
      }
    }
    return c.json({ ok: true, revoked: n });
  });

  app.post('/api/sessions/:jti/revoke', (c) => {
    const p = c.req.param('jti');
    // The UI sends the 12-char prefix shown by GET /api/sessions; shorter
    // prefixes are rejected to avoid prefix-collision revocations.
    if (p.length < 6) return fail(c, 400, 'Identificador de sesión demasiado corto');
    const target = [...issued.keys()].find((j) => j === p || j.startsWith(p));
    if (!target) {
      if ([...revoked.keys()].some((j) => j === p || j.startsWith(p))) return c.json({ ok: true });
      return fail(c, 404, 'Sesión no encontrada');
    }
    revokeSession(target);
    return c.json({ ok: true });
  });
}
