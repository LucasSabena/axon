import { readFile } from 'fs/promises';
import * as path from 'path';
import { hostToContainer, readHostFile } from './host';
import type { DomainHostCheck, DomainHostChange, DomainMapping, PortProcess } from './types';

// A published domain can route perfectly through Cloudflare and the tunnel and
// still be unusable: dev servers reject requests whose Host header they don't
// recognise (DNS-rebinding protection). Vite answers 403 "Blocked request.
// This host is not allowed" until the hostname is listed in allowedHosts.
// Axon repairs that file instead of leaving the user to decode the 403.

const CONFIG_NAMES = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.mts', 'vite.config.cjs'];
// cwd is where Vite resolves its config; a parent covers monorepos started one
// level above the app (apps/web) without wandering far.
const CONFIG_SEARCH_DEPTH = 2;

export interface HostFixResult {
  ok: boolean;
  already?: boolean;
  file?: string;
  changes?: DomainHostChange[];
  restart?: { ok: boolean; pid?: number; error?: string };
  error?: string;
}

// ---------- source scanning ----------
// Configs are read as text: parsing TS would need a compiler, and a byte-exact
// edit that keeps the author's formatting is the whole point.

function skipString(text: string, i: number): number {
  const quote = text[i];
  i++;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === quote) return i + 1;
    i++;
  }
  return text.length;
}

function skipComment(text: string, i: number): number {
  if (text[i + 1] === '/') {
    const nl = text.indexOf('\n', i + 2);
    return nl < 0 ? text.length : nl;
  }
  const end = text.indexOf('*/', i + 2);
  return end < 0 ? text.length : end + 2;
}

function isCommentStart(text: string, i: number): boolean {
  return text[i] === '/' && (text[i + 1] === '/' || text[i + 1] === '*');
}

function findMatching(text: string, open: number, openCh = '{', closeCh = '}'): number {
  let depth = 0;
  for (let i = open; i < text.length;) {
    if (text[i] === '"' || text[i] === "'" || text[i] === '`') { i = skipString(text, i); continue; }
    if (isCommentStart(text, i)) { i = skipComment(text, i); continue; }
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh && --depth === 0) return i;
    i++;
  }
  return -1;
}

function lineIndent(text: string, index: number): string {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, index));
  return match ? match[0] : '';
}

/** Object literal handed to defineConfig (or exported directly). */
function findConfigObject(text: string): { open: number; close: number } | null {
  const patterns = [/defineConfig\s*\(\s*\{/, /export\s+default\s*\{/];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const open = m.index + m[0].length - 1;
    const close = findMatching(text, open);
    if (close > open) return { open, close };
  }
  return null;
}

const IDENT_CHAR = /[\w$]/;

/** Index of `key` used as an object property at depth 0 of [start, end). */
function findTopLevelKey(text: string, start: number, end: number, key: string): number {
  return findTopLevelProperty(text, start, end, key, false);
}

/**
 * Property at depth 0: `key: value`, plus the shorthand `key,` / `key}` when
 * allowed — `preview: { allowedHosts }` is common and still has to be seen.
 */
function findTopLevelProperty(text: string, start: number, end: number, key: string, shorthand: boolean): number {
  let depth = 0;
  for (let i = start; i < end;) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue; }
    if (isCommentStart(text, i)) { i = skipComment(text, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth--; i++; continue; }
    if (depth === 0 && text.startsWith(key, i)
      && !IDENT_CHAR.test(text[i - 1] ?? '') && !IDENT_CHAR.test(text[i + key.length] ?? '')) {
      let j = i + key.length;
      while (j < end && /\s/.test(text[j])) j++;
      if (text[j] === ':') return i;
      if (shorthand && (text[j] === ',' || text[j] === '}' || j >= end)) return i;
    }
    i++;
  }
  return -1;
}

/** `const allowedHosts = […]` at module scope — the usual way to share one list. */
function findVariableArray(text: string, name: string): { open: number; close: number } | null {
  const re = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::\\s*[^=\\n]+)?=\\s*\\[`);
  const m = re.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = findMatching(text, open, '[', ']');
  return close > open ? { open, close } : null;
}

/** First `key: { … }` block that sits directly in the config object. */
function findKeyBlock(text: string, key: string, config: { open: number; close: number } | null): { open: number; close: number } | null {
  const re = new RegExp(`\\b${key}\\s*:\\s*\\{`, 'g');
  let fallback: { open: number; close: number } | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const open = m.index + m[0].length - 1;
    const close = findMatching(text, open);
    if (close < open) continue;
    if (!config) return { open, close };
    const inConfig = open > config.open && close < config.close;
    const topLevel = inConfig && findTopLevelKey(text, config.open + 1, open, key) === m.index;
    if (topLevel) return { open, close };
    fallback ||= { open, close };
  }
  return null;
}

/** Quote-delimited strings inside an allowedHosts array. */
function arrayEntries(text: string, open: number, close: number): string[] {
  const literal = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const slice = text.slice(open + 1, close);
  const out: string[] = [];
  for (const m of slice.matchAll(literal)) out.push(m[2]);
  return out;
}

/** Vite: an entry covers its own name; a leading dot also covers subdomains. */
function coversHost(entries: string[], host: string): boolean {
  return entries.some((entry) => {
    if (entry === host) return true;
    if (!entry.startsWith('.')) return false;
    const base = entry.slice(1);
    return host === base || host.endsWith(`.${base}`);
  });
}

/** `a, b` → `a, b, c` (or `c` when empty), keeping single/multi-line layout. */
function appendEntry(text: string, open: number, close: number, host: string): string {
  const inner = text.slice(open + 1, close);
  const entry = `'${host}'`;
  const last = inner.replace(/\s+$/, '');
  const needsComma = last.trim() !== '' && !last.endsWith(',');
  if (!inner.includes('\n')) {
    return text.slice(0, close) + `${needsComma ? ', ' : ''}${entry}` + text.slice(close);
  }
  // Multi-line array: append on its own line, after the last entry.
  let at = open + 1;
  for (let i = close - 1; i > open; i--) {
    if (!/\s/.test(text[i])) { at = i + 1; break; }
  }
  const indent = lineIndent(text, at > open + 1 ? at - 1 : close);
  const pad = indent || lineIndent(text, close) + '  ';
  return text.slice(0, at) + `${needsComma ? ',' : ''}\n${pad}${entry}` + text.slice(at);
}

export interface AllowedHostsPlan {
  /** the host is already allowed — nothing to write */
  allowed: boolean;
  /** a byte-exact edit could be produced */
  autoFixable: boolean;
  patched?: string;
  changes: DomainHostChange[];
  note?: string;
}

/**
 * Pure planner: given a Vite config's source, decide whether `host` is allowed
 * by `server.allowedHosts` / `preview.allowedHosts` and produce the edit.
 */
export function planAllowedHosts(
  text: string,
  opts: { key: 'server' | 'preview'; host: string }
): AllowedHostsPlan {
  const { key, host } = opts;
  const config = findConfigObject(text);
  if (!config) {
    return {
      allowed: false, autoFixable: false, changes: [],
      note: 'El archivo no expone un objeto de configuración reconocible (defineConfig({…}))',
    };
  }

  const block = findKeyBlock(text, key, config);
  if (!block) {
    const indent = lineIndent(text, config.close) + '  ';
    const insertAt = config.close;
    const before = text.slice(config.open + 1, insertAt).replace(/\s+$/, '');
    const needsComma = before.trim() !== '' && !before.endsWith(',') && !before.endsWith('{');
    const property = `${key}: { allowedHosts: ['${host}'] }`;
    const patched = text.slice(0, insertAt) + `${needsComma ? ',' : ''}\n${indent}${property},\n` + text.slice(insertAt);
    return {
      allowed: false,
      autoFixable: true,
      patched,
      changes: [{ key: `${key}.allowedHosts`, value: `['${host}']` }],
    };
  }

  const keyAt = findTopLevelProperty(text, block.open + 1, block.close, 'allowedHosts', true);
  if (keyAt < 0) {
    const closeIndent = lineIndent(text, block.close);
    const singleLine = !text.slice(block.open, block.close).includes('\n');
    const property = `allowedHosts: ['${host}']`;
    const patched = singleLine
      ? text.slice(0, block.open + 1) + ` ${property},` + text.slice(block.open + 1)
      : text.slice(0, block.open + 1) + `\n${closeIndent}  ${property},` + text.slice(block.open + 1);
    return {
      allowed: false,
      autoFixable: true,
      patched,
      changes: [{ key: `${key}.allowedHosts`, value: `['${host}']` }],
    };
  }

  let valueAt = keyAt + 'allowedHosts'.length;
  while (valueAt < block.close && /\s/.test(text[valueAt])) valueAt++;
  // `preview: { allowedHosts }` — the value is the module-level constant.
  const shorthand = text[valueAt] !== ':';
  if (!shorthand) {
    valueAt++;
    while (valueAt < block.close && /\s/.test(text[valueAt])) valueAt++;
  }

  const arrayPlan = (open: number, close: number, changeKey: string): AllowedHostsPlan => {
    const entries = arrayEntries(text, open, close);
    if (coversHost(entries, host)) return { allowed: true, autoFixable: true, changes: [] };
    return {
      allowed: false,
      autoFixable: true,
      patched: appendEntry(text, open, close, host),
      changes: [{ key: changeKey, value: `[${[...entries, host].map((e) => `'${e}'`).join(', ')}]` }],
    };
  };

  if (shorthand) {
    const variable = findVariableArray(text, 'allowedHosts');
    if (variable) return arrayPlan(variable.open, variable.close, 'allowedHosts');
    return {
      allowed: false, autoFixable: false, changes: [],
      note: 'allowedHosts usa una variable que no se define en este archivo',
    };
  }

  if (text.startsWith('true', valueAt)) {
    return { allowed: true, autoFixable: true, changes: [] };
  }
  if (text.startsWith('false', valueAt)) {
    const patched = `${text.slice(0, valueAt)}['${host}']${text.slice(valueAt + 'false'.length)}`;
    return {
      allowed: false, autoFixable: true, patched,
      changes: [{ key: `${key}.allowedHosts`, value: `['${host}']` }],
    };
  }
  if (text[valueAt] === '[') {
    const close = findMatching(text, valueAt, '[', ']');
    if (close < 0) {
      return { allowed: false, autoFixable: false, changes: [], note: 'El array allowedHosts no cierra' };
    }
    return arrayPlan(valueAt, close, `${key}.allowedHosts`);
  }
  const ident = /^[A-Za-z_$][\w$]*/.exec(text.slice(valueAt, block.close));
  if (ident) {
    const variable = findVariableArray(text, ident[0]);
    if (variable) return arrayPlan(variable.open, variable.close, ident[0]);
    return {
      allowed: false, autoFixable: false, changes: [],
      note: `allowedHosts apunta a ${ident[0]}, que se define fuera de este archivo`,
    };
  }
  return {
    allowed: false, autoFixable: false, changes: [],
    note: `${key}.allowedHosts usa una expresión que no se puede editar sin analizarla`,
  };
}

// ---------- live check ----------

function modeFromCommand(cmd: string): 'dev' | 'preview' {
  // `vite preview` is a subcommand; `vite` alone is the dev server.
  return /\bpreview\b/.test(cmd) ? 'preview' : 'dev';
}

async function findConfig(hostCwd: string): Promise<string | null> {
  let dir = hostCwd.replace(/\/+$/, '') || '/';
  for (let depth = 0; depth <= CONFIG_SEARCH_DEPTH; depth++) {
    for (const name of CONFIG_NAMES) {
      const candidate = path.posix.join(dir, name);
      try {
        await readFile(hostToContainer(candidate), 'utf8');
        return candidate;
      } catch { /* not here */ }
    }
    const parent = path.posix.dirname(dir);
    if (parent === dir || dir === '/') break;
    dir = parent;
  }
  return null;
}

export function processForDomain(domain: DomainMapping, procs: PortProcess[]): PortProcess | undefined {
  return procs.find((p) => p.listeners?.some((l) => l.port === domain.port))
    ?? procs.find((p) => p.ports?.includes(domain.port));
}

/**
 * Inspect the process behind a published domain and report whether it will
 * reject the hostname. Not applicable for containers or non-Vite servers.
 */
export async function checkDomainHost(
  domain: DomainMapping,
  procs: PortProcess[],
  allowHost: string
): Promise<DomainHostCheck> {
  const base: DomainHostCheck = { applicable: false, blocked: false, autoFixable: false, changes: [], summary: '' };
  if (domain.processType === 'docker') {
    return { ...base, summary: 'El destino es un contenedor: no hay config de Vite que revisar' };
  }
  const proc = processForDomain(domain, procs);
  if (!proc?.cwd) {
    return { ...base, summary: 'No se encontró el proceso que atiende ese puerto' };
  }
  const config = await findConfig(proc.cwd).catch(() => null);
  const isVite = Boolean(config) || /\bvite\b/.test(proc.cmd) || /\bvite\b/.test(proc.name);
  if (!isVite) return { ...base, summary: 'El destino no parece un servidor Vite' };
  if (!config) {
    return {
      ...base,
      applicable: true,
      framework: 'vite',
      blocked: true,
      autoFixable: false,
      summary: 'Vite no tiene config en la carpeta del proceso: hay que crear vite.config.ts con allowedHosts',
    };
  }

  const mode = modeFromCommand(proc.cmd);
  const text = await readHostFile(config);
  const plan = planAllowedHosts(text, { key: mode === 'preview' ? 'preview' : 'server', host: allowHost });
  return {
    applicable: true,
    framework: 'vite',
    file: config,
    mode,
    blocked: !plan.allowed,
    autoFixable: plan.autoFixable,
    changes: plan.changes,
    summary: plan.allowed
      ? `Vite ya permite ${allowHost}`
      : plan.note || `Vite bloquea ${allowHost}: hay que agregarlo a allowedHosts`,
  };
}

/**
 * Apply the allowedHosts edit and, when asked, relaunch the process so the
 * change takes effect (Vite reads its config only at startup).
 */
export async function applyDomainHostFix(
  domain: DomainMapping,
  procs: PortProcess[],
  allowHost: string,
  opts: { restart?: boolean; write: (hostPath: string, content: string) => Promise<{ ok: boolean; error?: string }>; restartProcess: (proc: PortProcess) => Promise<{ ok: boolean; pid?: number; error?: string }> }
): Promise<HostFixResult> {
  const check = await checkDomainHost(domain, procs, allowHost);
  if (!check.applicable) return { ok: false, error: check.summary };
  if (!check.blocked) return { ok: true, already: true, file: check.file };
  if (!check.autoFixable || !check.file) return { ok: false, error: check.summary };

  const text = await readHostFile(check.file);
  const plan = planAllowedHosts(text, { key: check.mode === 'preview' ? 'preview' : 'server', host: allowHost });
  if (!plan.patched) return { ok: false, error: plan.note || 'No hay nada para escribir' };

  const written = await opts.write(check.file, plan.patched);
  if (!written.ok) return { ok: false, error: written.error || 'No se pudo escribir el archivo' };

  if (!opts.restart) return { ok: true, file: check.file, changes: plan.changes };
  const proc = processForDomain(domain, procs);
  if (!proc) return { ok: true, file: check.file, changes: plan.changes };
  const restart = await opts.restartProcess(proc);
  return { ok: true, file: check.file, changes: plan.changes, restart };
}
