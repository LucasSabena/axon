// Per-entry preferences for the Ports page: custom name, hidden from the
// normal list, and blocked from being closed by accident.
//
// Keys are stable across restarts on purpose:
//   port:<n>            one listening port
//   group:<projectRoot> a project group (its children share the folder)
// Prefs are presentation + safety only; they never hide a port from the
// system or from other panels.

export interface PortPref {
  label?: string;
  hidden?: boolean;
  protected?: boolean;
}

export type PortPrefs = Record<string, PortPref>;

export interface ResolvedPortPrefs {
  label?: string;
  hidden: boolean;
  hiddenPorts: number[];
  protected: boolean;
}

export interface PortPrefPatch {
  label?: string | null;
  hidden?: boolean;
  protected?: boolean;
}

const MAX_PREFS = 2000;
const MAX_LABEL = 64;
const MAX_GROUP_PATH = 4096;
const PORT_KEY_RE = /^port:([1-9]\d{0,4})$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export function portPrefKey(port: number): string {
  return `port:${port}`;
}

export function groupPrefKey(root: string): string {
  return `group:${root}`;
}

export function isValidPortPrefKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key || key.length > MAX_GROUP_PATH + 7) return false;
  if (CONTROL_RE.test(key)) return false;
  const port = PORT_KEY_RE.exec(key);
  if (port) return Number(port[1]) <= 65535;
  if (!key.startsWith('group:/')) return false;
  return key.length > 'group:/'.length;
}

export function normalizePortLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim();
  if (!label || label.length > MAX_LABEL || CONTROL_RE.test(label)) return undefined;
  return label;
}

function normalizePref(value: unknown): PortPref | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const src = value as Record<string, unknown>;
  const pref: PortPref = {};
  const label = normalizePortLabel(src.label);
  if (label) pref.label = label;
  if (src.hidden === true) pref.hidden = true;
  if (src.protected === true) pref.protected = true;
  return Object.keys(pref).length ? pref : null;
}

/** Drop malformed entries instead of making the whole config unreadable. */
export function normalizePortPrefs(input: unknown): PortPrefs {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: PortPrefs = {};
  let stored = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (stored >= MAX_PREFS) break;
    if (!isValidPortPrefKey(key)) continue;
    const pref = normalizePref(value);
    if (pref) { out[key] = pref; stored++; }
  }
  return out;
}

export function resolvePortPrefs(prefs: PortPrefs, ports: number[]): ResolvedPortPrefs {
  const unique = [...new Set(ports.filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b);
  const resolved: ResolvedPortPrefs = { hidden: false, hiddenPorts: [], protected: false };
  for (const port of unique) {
    const pref = prefs[portPrefKey(port)];
    if (!pref) continue;
    if (pref.label && !resolved.label) resolved.label = pref.label;
    if (pref.hidden) resolved.hiddenPorts.push(port);
    if (pref.protected) resolved.protected = true;
  }
  resolved.hidden = unique.length > 0 && resolved.hiddenPorts.length === unique.length;
  return resolved;
}

/**
 * Apply one API patch to the map. `false` and an empty label remove the field;
 * a pref left with no fields disappears entirely so config stays tidy.
 */
export function applyPortPrefPatch(prefs: PortPrefs, key: string, patch: PortPrefPatch): PortPrefs {
  if (!isValidPortPrefKey(key)) throw new Error('Referencia de puerto inválida');
  const next: PortPrefs = { ...prefs };
  const pref: PortPref = { ...(next[key] || {}) };

  if ('label' in patch) {
    if (patch.label === null || (typeof patch.label === 'string' && !patch.label.trim())) delete pref.label;
    else {
      const label = normalizePortLabel(patch.label);
      if (!label) throw new Error('El nombre debe tener entre 1 y 64 caracteres y una sola línea');
      pref.label = label;
    }
  }
  if ('hidden' in patch) {
    if (typeof patch.hidden !== 'boolean') throw new Error('Valor inválido en hidden');
    if (patch.hidden) pref.hidden = true; else delete pref.hidden;
  }
  if ('protected' in patch) {
    if (typeof patch.protected !== 'boolean') throw new Error('Valor inválido en protected');
    if (patch.protected) pref.protected = true; else delete pref.protected;
  }

  if (Object.keys(pref).length) {
    if (!next[key] && Object.keys(next).length >= MAX_PREFS) throw new Error('Demasiadas preferencias guardadas');
    next[key] = pref;
  } else {
    delete next[key];
  }
  return next;
}
