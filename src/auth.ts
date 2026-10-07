import type { Context, MiddlewareHandler } from 'hono';

const COOKIE_NAME = 'axon_session';
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required');
}

interface SessionPayload {
  username: string;
  exp: number;
  jti?: string;
}

async function sign(payload: SessionPayload): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  const body = btoa(String.fromCharCode(...data));
  return `${body}.${signature}`;
}

async function verify(token: string): Promise<SessionPayload | null> {
  try {
    const [body, signature] = token.split('.');
    if (!body || !signature) return null;

    const data = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    const sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify('HMAC', key, sig, data);
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(data)) as SessionPayload;
    // exp must be a finite number — a non-numeric one would never expire.
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID();
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    key,
    256
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return timingSafeEqual(computed, hash);
}

// Constant-time string compare — avoids leaking the hash prefix via timing.
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export async function createSession(username: string): Promise<string> {
  return sign({ username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, jti: crypto.randomUUID() });
}

// For the raw WS upgrade path (outside Hono middleware).
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  return verify(token);
}

export async function getSession(c: Context): Promise<SessionPayload | null> {
  const cookie = c.req.header('cookie') || '';
  // Anchored like legacySessionId/sessionIdFromRequest — an unanchored match
  // would let a shadow cookie (xaxon_session=...) pass verification with a
  // token that never entered the revocation registry.
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  return verify(match[1]);
}

export function setSessionCookie(c: Context, token: string): void {
  // Behind cloudflared the origin sees http://localhost — the real scheme lives
  // in X-Forwarded-Proto / CF-Visitor. Only mark Secure when the client-facing
  // scheme is https so direct http access (Tailscale/LAN) keeps working.
  const fwd = c.req.header('x-forwarded-proto')?.toLowerCase();
  const cfScheme = c.req.header('cf-visitor') || '';
  const isHttps =
    fwd === 'https' ||
    cfScheme.includes('"scheme":"https"') ||
    c.req.url.startsWith('https://');
  const secure = isHttps ? '; Secure' : '';
  c.header(
    'set-cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${secure}`
  );
}

export function clearSessionCookie(c: Context): void {
  c.header('set-cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Optional revocation hook — wired by the sessions module at boot so auth.ts
// stays dependency-free.
let revokedCheck: ((sessionId: string) => boolean) | null = null;
let touchHook: ((sessionId: string) => void) | null = null;
export function setSessionHooks(hooks: { isRevoked?: (id: string) => boolean; touch?: (id: string) => void }): void {
  revokedCheck = hooks.isRevoked || null;
  touchHook = hooks.touch || null;
}

// Session id used by the sessions registry: the `jti` claim, or a stable
// `tok-<sha256>` of the raw cookie for tokens minted before jti existed —
// must match sessions.ts sessionIdForToken().
function legacySessionId(cookie: string, payload: SessionPayload): string | null {
  if (payload.jti) return payload.jti;
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  try {
    const hash = new Bun.CryptoHasher('sha256')
      .update(decodeURIComponent(match[1]))
      .digest('hex')
      .slice(0, 32);
    return `tok-${hash}`;
  } catch {
    return null;
  }
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const cookie = c.req.header('cookie') || '';
  const session = await getSession(c);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const sid = legacySessionId(cookie, session);
  if (sid) {
    if (revokedCheck?.(sid)) return c.json({ error: 'Sesión revocada' }, 401);
    touchHook?.(sid);
  }
  c.set('user', session.username);
  await next();
};

declare module 'hono' {
  interface ContextVariableMap {
    user: string;
  }
}
