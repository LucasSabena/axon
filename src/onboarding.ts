import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import * as path from 'path';
import type { Context, Hono } from 'hono';
import type { AppConfig } from './types';

// ---------- First-run onboarding ----------
// A fresh install drops data/onboarding.json (written by deployment/axon.py).
// That file drives three surfaces:
//   1. the pre-login setup step — a one-time token (?setup=…) that authorizes
//      creating the admin account in the browser;
//   2. the guided wizard after the account exists (detection + preferences);
//   3. the "Primeros pasos" checklist on the dashboard.
// Installations that predate the feature have no file and behave exactly as
// before (step 'legacy'). `axon reset-onboarding` recreates the file so the
// wizard/checklist can be revisited.

export interface OnboardingFile {
  version: 1;
  createdAt: string;
  /** One-time token printed by the installer. Deleted when consumed. */
  setupToken?: string;
  /** Wizard finished (or the user skipped it). */
  completedAt?: string;
  /** "Ya conozco el panel" — hides the dashboard checklist. */
  checklistDismissed?: boolean;
  /** Checklist items the user marked by hand (non-computable ones). */
  manualDone?: string[];
}

export type OnboardingStep = 'legacy' | 'setup' | 'wizard' | 'done';

export function onboardingStep(state: OnboardingFile | null): OnboardingStep {
  if (!state) return 'legacy';
  if (state.completedAt) return 'done';
  return state.setupToken ? 'setup' : 'wizard';
}

const FILE = path.join(path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'), 'onboarding.json');

let saveQueue: Promise<void> = Promise.resolve();

// No cache — `axon reset-onboarding` can rewrite the file under a running
// server, and reads are small + rare (only the onboarding endpoints).
export async function loadOnboarding(): Promise<OnboardingFile | null> {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf-8'));
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function saveOnboarding(next: OnboardingFile | null): Promise<void> {
  const operation = saveQueue.catch(() => {}).then(async () => {
    await mkdir(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
    await rename(temp, FILE);
  });
  saveQueue = operation;
  return operation;
}

// Constant-time compare — a fast === would leak the token prefix via timing.
function tokensEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

export interface ChecklistItem {
  id: string;
  done: boolean;
  /** true = the server can verify it; false = marked manually by the user. */
  auto: boolean;
}

export function checklistItems(state: OnboardingFile, config: AppConfig, backups: number): ChecklistItem[] {
  const manual = new Set(state.manualDone || []);
  const item = (id: string, auto: boolean, done: boolean): ChecklistItem => ({ id, auto, done: done || manual.has(id) });
  return [
    item('account', true, true),
    item('projects', true, (config.projects || []).length > 0),
    item('domain', true, (config.domains || []).length > 0),
    item('backup', true, backups > 0),
    item('twofa', true, !!config.auth.totpSecret),
    item('explore', false, false),
  ];
}

const MANUAL_ITEMS = new Set(['explore']);

export interface OnboardingDeps {
  getConfig: () => AppConfig;
  /** Replaces config.auth credentials and persists the config file. */
  saveAuth: (username: string, passwordHash: string) => Promise<void>;
  hashPassword: (password: string) => Promise<string>;
  /** Mints the session cookie + registry entry for a just-created account. */
  startSession: (c: Context, username: string) => Promise<void>;
  backupCount: () => number;
  probe: () => Promise<unknown>;
  recordEvent: (type: string, title: string) => void;
  /** Shared brute-force guard — same counters as /api/login. */
  lockRemaining: (c: Context) => number;
  noteFail: (c: Context, label: string) => void;
}

function fail(c: Context, status: number, error: string) {
  return c.json({ ok: false, error }, status as never);
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{1,32}$/;
const MIN_PASSWORD = 8;

// Public routes — registered BEFORE the requireAuth middleware. The setup
// endpoint is the only unauthenticated mutation: it requires the one-time
// token the installer prints, and shares the login brute-force lockout.
export function registerOnboardingPublic(app: Hono, deps: OnboardingDeps): void {
  app.get('/api/onboarding/status', async (c) => {
    const step = onboardingStep(await loadOnboarding());
    return c.json({ ok: true, step, pending: step === 'setup' });
  });

  app.post('/api/onboarding/setup', async (c) => {
    const lockMs = deps.lockRemaining(c);
    if (lockMs > 0) {
      const sec = Math.ceil(lockMs / 1000);
      c.header('Retry-After', String(sec));
      return fail(c, 429, `Demasiados intentos — probá en ${Math.max(1, Math.ceil(sec / 60))} min`);
    }
    const state = await loadOnboarding();
    if (!state?.setupToken || state.completedAt) {
      return fail(c, 403, 'La configuración inicial ya está hecha. Iniciá sesión normalmente.');
    }
    const body = await c.req.json<{ token?: string; username?: string; password?: string }>().catch(() => ({} as { token?: string; username?: string; password?: string }));
    const username = String(body.username || 'admin').trim();
    const password = String(body.password || '');
    if (!tokensEqual(String(body.token || ''), state.setupToken)) {
      deps.noteFail(c, 'setup');
      return fail(c, 403, 'El enlace de configuración no es válido o ya se usó.');
    }
    if (!USERNAME_RE.test(username)) {
      return fail(c, 400, 'El usuario admite letras, números, guiones y puntos (máx. 32).');
    }
    if (password.length < MIN_PASSWORD || password.length > 200) {
      return fail(c, 400, `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`);
    }
    await deps.saveAuth(username, await deps.hashPassword(password));
    const { setupToken: _consumed, ...rest } = state;
    await saveOnboarding({ ...rest });
    deps.recordEvent('auth', `Cuenta de administrador creada — ${username}`);
    await deps.startSession(c, username);
    return c.json({ ok: true, username });
  });
}

// Authenticated routes — registered AFTER requireAuth.
export function registerOnboardingRoutes(app: Hono, deps: OnboardingDeps): void {
  app.get('/api/onboarding/state', async (c) => {
    const state = await loadOnboarding();
    return c.json({
      ok: true,
      step: onboardingStep(state),
      completedAt: state?.completedAt ?? null,
      dismissed: !!state?.checklistDismissed,
      items: state ? checklistItems(state, deps.getConfig(), deps.backupCount()) : [],
    });
  });

  app.get('/api/onboarding/probe', async (c) => {
    return c.json({ ok: true, probe: await deps.probe() });
  });

  app.post('/api/onboarding/complete', async (c) => {
    const state = await loadOnboarding();
    if (!state) return fail(c, 404, 'Esta instalación no tiene primeros pasos pendientes.');
    if (!state.completedAt) {
      deps.recordEvent('auth', 'Configuración inicial completada');
      await saveOnboarding({ ...state, completedAt: new Date().toISOString() });
    }
    return c.json({ ok: true });
  });

  app.post('/api/onboarding/dismiss', async (c) => {
    const state = await loadOnboarding();
    if (!state) return fail(c, 404, 'Esta instalación no tiene primeros pasos pendientes.');
    await saveOnboarding({
      ...state,
      checklistDismissed: true,
      completedAt: state.completedAt || new Date().toISOString(),
    });
    return c.json({ ok: true });
  });

  app.post('/api/onboarding/check', async (c) => {
    const state = await loadOnboarding();
    if (!state) return fail(c, 404, 'Esta instalación no tiene primeros pasos pendientes.');
    const { id } = await c.req.json<{ id?: string }>().catch(() => ({} as { id?: string }));
    if (!id || !MANUAL_ITEMS.has(id)) return fail(c, 400, 'Ese paso se completa solo, no a mano.');
    if (!state.manualDone?.includes(id)) {
      await saveOnboarding({ ...state, manualDone: [...(state.manualDone || []), id] });
    }
    return c.json({ ok: true });
  });

  app.post('/api/onboarding/reset', async (c) => {
    const state = await loadOnboarding();
    const fresh: OnboardingFile = {
      version: 1,
      createdAt: state?.createdAt || new Date().toISOString(),
    };
    deps.recordEvent('auth', 'Primeros pasos reiniciados');
    await saveOnboarding(fresh);
    return c.json({ ok: true });
  });
}
