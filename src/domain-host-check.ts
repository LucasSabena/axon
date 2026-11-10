import { access } from 'fs/promises';
import * as path from 'path';
import { hostToContainer, readHostFile } from './host';
import type { DomainHostCheck, DomainHostChange, DomainHostDiffLine, DomainMapping, PortProcess } from './types';

// A published domain can route perfectly through Cloudflare and the tunnel and
// still be unusable: dev servers reject requests whose Host header they don't
// recognise (DNS-rebinding protection). Vite answers 403 "Blocked request.
// This host is not allowed" until the hostname is listed in allowedHosts.
// Axon repairs that file instead of leaving the user to decode the 403.

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

/**
 * The config object itself: the literal handed to defineConfig /
 * defineNuxtConfig, a literal exported directly, or a named literal that is
 * exported (`const nextConfig: NextConfig = {…}; export default nextConfig`,
 * also when wrapped: `export default withMDX(nextConfig)`).
 */
function findConfigObject(text: string): { open: number; close: number } | null {
  const literal = [
    /define(?:Nuxt)?Config\s*\(\s*\{/,
    /export\s+default\s*\{/,
    /module\.exports\s*=\s*\{/,
  ];
  for (const re of literal) {
    const m = re.exec(text);
    if (!m) continue;
    const open = m.index + m[0].length - 1;
    const close = findMatching(text, open);
    if (close > open) return { open, close };
  }
  const named = /(?:export\s+default|module\.exports\s*=)\s*(?:[A-Za-z_$][\w$]*\s*\(\s*)*([A-Za-z_$][\w$]*)\s*\)*\s*;?/.exec(text);
  if (named) {
    const re = new RegExp(`\\b(?:const|let|var)\\s+${named[1].replace(/\$/g, '\\$')}\\s*(?::\\s*[^=\\n]+)?=\\s*\\{`);
    const m = re.exec(text);
    if (m) {
      const open = m.index + m[0].length - 1;
      const close = findMatching(text, open);
      if (close > open) return { open, close };
    }
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

type Span = { open: number; close: number };

/**
 * `key: { … }` sitting directly in `parent`. Returns null when the key is
 * absent and 'opaque' when it exists but its value is not an object literal
 * (a variable, a function call) — that can't be edited safely.
 */
function findKeyBlock(text: string, key: string, parent: Span): Span | 'opaque' | null {
  const at = findTopLevelKey(text, parent.open + 1, parent.close, key);
  if (at < 0) return null;
  let i = at + key.length;
  while (i < parent.close && /\s/.test(text[i])) i++;
  i++; // ':'
  while (i < parent.close && /\s/.test(text[i])) i++;
  if (text[i] !== '{') return 'opaque';
  const close = findMatching(text, i);
  return close > i ? { open: i, close } : 'opaque';
}

/** Quote-delimited strings inside an allowedHosts array. */
function arrayEntries(text: string, open: number, close: number): string[] {
  const literal = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  const slice = text.slice(open + 1, close);
  const out: string[] = [];
  for (const m of slice.matchAll(literal)) out.push(m[2]);
  return out;
}

/**
 * An entry covers its own name; a leading dot (Vite, Astro) or `*.` (Next's
 * allowedDevOrigins) also covers subdomains. `host` may itself be a pattern.
 */
function coversHost(entries: string[], host: string): boolean {
  const bare = (h: string) => h.replace(/^\*\./, '.');
  const want = bare(host);
  return entries.some((raw) => {
    const entry = bare(raw);
    if (entry === '*' || entry === want) return true;
    if (!entry.startsWith('.')) return false;
    const base = entry.slice(1);
    const target = want.startsWith('.') ? want.slice(1) : want;
    return target === base || target.endsWith(`.${base}`);
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

export interface PlanOptions {
  host: string;
  /** Vite shorthand: path = [key] */
  key?: 'server' | 'preview';
  /** object path from the config root to the block that holds `prop` ([] = root) */
  path?: string[];
  /** list property to edit (default allowedHosts) */
  prop?: string;
}

/** `a: { b: { prop: ['host'] } }` for the part of the path that doesn't exist yet. */
function nestedProperty(path: string[], prop: string, host: string): string {
  let out = `${prop}: ['${host}']`;
  for (let i = path.length - 1; i >= 0; i--) out = `${path[i]}: { ${out} }`;
  return out;
}

/** Root object: the new property goes last, on its own line. */
function insertAtEnd(text: string, block: Span, property: string): string {
  const indent = lineIndent(text, block.close) + '  ';
  const before = text.slice(block.open + 1, block.close).replace(/\s+$/, '');
  const needsComma = before.trim() !== '' && !before.endsWith(',') && !before.endsWith('{');
  const singleLine = !text.slice(block.open, block.close).includes('\n');
  if (singleLine) {
    const body = before.trim() === '' ? ` ${property} ` : `${needsComma ? ',' : ''} ${property} `;
    return text.slice(0, block.open + 1) + before.slice(0) + body + text.slice(block.close);
  }
  // keep whatever sat between the last property and the brace (newline, indent)
  const lastAt = block.open + 1 + before.length;
  return text.slice(0, lastAt) + `${needsComma ? ',' : ''}\n${indent}${property},` + text.slice(lastAt);
}

/** Nested block: the new property goes first, so it is easy to spot. */
function insertAtStart(text: string, block: Span, property: string): string {
  const inner = text.slice(block.open + 1, block.close);
  if (inner.trim() === '') return text.slice(0, block.open + 1) + ` ${property} ` + text.slice(block.close);
  const singleLine = !text.slice(block.open, block.close).includes('\n');
  const closeIndent = lineIndent(text, block.close);
  return singleLine
    ? text.slice(0, block.open + 1) + ` ${property},` + text.slice(block.open + 1)
    : text.slice(0, block.open + 1) + `\n${closeIndent}  ${property},` + text.slice(block.open + 1);
}

/**
 * Pure planner: given a config's source, decide whether `host` is listed in
 * the list at `path.prop` (Vite server/preview.allowedHosts, Astro
 * server.allowedHosts, Nuxt vite.server.allowedHosts, Next allowedDevOrigins)
 * and produce the byte-exact edit.
 */
export function planAllowedHosts(text: string, opts: PlanOptions): AllowedHostsPlan {
  const { host } = opts;
  const path = opts.path ?? (opts.key ? [opts.key] : []);
  const prop = opts.prop ?? 'allowedHosts';
  const label = [...path, prop].join('.');
  const config = findConfigObject(text);
  if (!config) {
    return {
      allowed: false, autoFixable: false, changes: [],
      note: 'El archivo no expone un objeto de configuración reconocible (defineConfig({…}))',
    };
  }

  // Walk down the path; create whatever is missing in one insertion.
  let block: Span = config;
  for (let depth = 0; depth < path.length; depth++) {
    const next = findKeyBlock(text, path[depth], block);
    if (next === 'opaque') {
      return {
        allowed: false, autoFixable: false, changes: [],
        note: `${path.slice(0, depth + 1).join('.')} no es un objeto escrito en el archivo: hay que editarlo a mano`,
      };
    }
    if (!next) {
      const property = nestedProperty(path.slice(depth), prop, host);
      const patched = block === config ? insertAtEnd(text, block, property) : insertAtStart(text, block, property);
      return { allowed: false, autoFixable: true, patched, changes: [{ key: label, value: `['${host}']` }] };
    }
    block = next;
  }

  const keyAt = findTopLevelProperty(text, block.open + 1, block.close, prop, true);
  if (keyAt < 0) {
    const property = `${prop}: ['${host}']`;
    const patched = block === config ? insertAtEnd(text, block, property) : insertAtStart(text, block, property);
    return { allowed: false, autoFixable: true, patched, changes: [{ key: label, value: `['${host}']` }] };
  }

  let valueAt = keyAt + prop.length;
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
    const variable = findVariableArray(text, prop);
    if (variable) return arrayPlan(variable.open, variable.close, prop);
    return {
      allowed: false, autoFixable: false, changes: [],
      note: `${prop} usa una variable que no se define en este archivo`,
    };
  }

  if (text.startsWith('true', valueAt)) {
    return { allowed: true, autoFixable: true, changes: [] };
  }
  if (text.startsWith('false', valueAt)) {
    const patched = `${text.slice(0, valueAt)}['${host}']${text.slice(valueAt + 'false'.length)}`;
    return {
      allowed: false, autoFixable: true, patched,
      changes: [{ key: label, value: `['${host}']` }],
    };
  }
  if (text[valueAt] === '[') {
    const close = findMatching(text, valueAt, '[', ']');
    if (close < 0) {
      return { allowed: false, autoFixable: false, changes: [], note: `El array ${prop} no cierra` };
    }
    return arrayPlan(valueAt, close, label);
  }
  const ident = /^[A-Za-z_$][\w$]*/.exec(text.slice(valueAt, block.close));
  if (ident) {
    const variable = findVariableArray(text, ident[0]);
    if (variable) return arrayPlan(variable.open, variable.close, ident[0]);
    return {
      allowed: false, autoFixable: false, changes: [],
      note: `${prop} apunta a ${ident[0]}, que se define fuera de este archivo`,
    };
  }
  return {
    allowed: false, autoFixable: false, changes: [],
    note: `${label} usa una expresión que no se puede editar sin analizarla`,
  };
}

/** Changed lines with one line of context, for the confirmation modal. */
export function diffLines(before: string, after: string): DomainHostDiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let top = 0;
  while (top < a.length && top < b.length && a[top] === b[top]) top++;
  let tail = 0;
  while (tail < a.length - top && tail < b.length - top && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const out: DomainHostDiffLine[] = [];
  const ctxStart = Math.max(0, top - 1);
  for (let i = ctxStart; i < top; i++) out.push({ kind: ' ', line: i + 1, text: a[i] });
  for (let i = top; i < a.length - tail; i++) out.push({ kind: '-', line: i + 1, text: a[i] });
  for (let i = top; i < b.length - tail; i++) out.push({ kind: '+', line: i + 1, text: b[i] });
  const afterEnd = b.length - tail;
  if (tail > 0) out.push({ kind: ' ', line: afterEnd + 1, text: b[afterEnd] });
  return out;
}

// ---------- live check ----------

type Mode = 'dev' | 'preview';

/** Where a framework keeps the list of accepted hostnames, for a given mode. */
interface HostRule {
  path: string[];
  prop: string;
  /** '.example.com' (Vite, Astro) or '*.example.com' (Next) */
  pattern: 'dot' | 'wildcard';
  /** the server re-reads its config by itself (dev servers watch the file) */
  reloadsItself: boolean;
}

interface Framework {
  id: string;
  label: string;
  configNames: string[];
  /** matches the command line of the process (or its parent) */
  cmd: RegExp;
  mode(cmd: string): Mode;
  /** null = this mode doesn't check the Host header, with the reason */
  rule(mode: Mode, version: number[] | null): HostRule | { skip: string } | { manual: string };
}

const jsNames = (base: string) => ['ts', 'mts', 'js', 'mjs', 'cjs'].map((ext) => `${base}.${ext}`);
const previewish = (cmd: string): Mode => (/\b(preview|start)\b/.test(cmd) ? 'preview' : 'dev');
const atLeast = (v: number[] | null, want: number[]) => {
  if (!v) return true;
  for (let i = 0; i < want.length; i++) {
    if ((v[i] ?? 0) !== want[i]) return (v[i] ?? 0) > want[i];
  }
  return true;
};

// Order matters: Astro, Nuxt and SvelteKit/React Router all sit on Vite, so
// the specific framework has to win before plain Vite claims the folder.
export const FRAMEWORKS: Framework[] = [
  {
    id: 'astro', label: 'Astro', configNames: jsNames('astro.config'), cmd: /\bastro(\.mjs)?\b/,
    mode: previewish,
    // Astro's own server.allowedHosts covers both `astro dev` and `astro preview`.
    rule: (mode) => ({ path: ['server'], prop: 'allowedHosts', pattern: 'dot', reloadsItself: mode === 'dev' }),
  },
  {
    id: 'nuxt', label: 'Nuxt', configNames: jsNames('nuxt.config'), cmd: /\bnux[ti]\b/,
    mode: previewish,
    rule: (mode) => mode === 'dev'
      ? { path: ['vite', 'server'], prop: 'allowedHosts', pattern: 'dot', reloadsItself: true }
      : { skip: 'Nuxt en producción (Nitro) no revisa el dominio' },
  },
  {
    id: 'next', label: 'Next.js', configNames: jsNames('next.config'), cmd: /\bnext(-server)?\b/,
    mode: (cmd) => (/\bnext\b.*\bstart\b/.test(cmd) ? 'preview' : 'dev'),
    // Next never refuses the page itself; since 15.2 `next dev` blocks the
    // dev assets and HMR from origins not listed in allowedDevOrigins.
    rule: (mode, version) => {
      if (mode !== 'dev') return { skip: 'next start no revisa el dominio' };
      if (!atLeast(version, [15, 2])) return { skip: 'Esta versión de Next no bloquea dominios' };
      return { path: [], prop: 'allowedDevOrigins', pattern: 'wildcard', reloadsItself: true };
    },
  },
  {
    id: 'angular', label: 'Angular', configNames: ['angular.json'], cmd: /\bng\b.*\bserve\b/,
    mode: () => 'dev',
    rule: () => ({ manual: 'Angular: agregá el dominio en angular.json → serve.options.allowedHosts, o arrancá con ng serve --allowed-hosts' }),
  },
  {
    id: 'vite', label: 'Vite', configNames: jsNames('vite.config'), cmd: /\bvite\b/,
    mode: (cmd) => (/\bpreview\b/.test(cmd) ? 'preview' : 'dev'),
    rule: (mode) => ({ path: [mode === 'preview' ? 'preview' : 'server'], prop: 'allowedHosts', pattern: 'dot', reloadsItself: mode === 'dev' }),
  },
];

async function firstExisting(dir: string, names: string[]): Promise<string | null> {
  for (const name of names) {
    const candidate = path.posix.join(dir, name);
    try {
      await access(hostToContainer(candidate));
      return candidate;
    } catch { /* not here */ }
  }
  return null;
}

/** Walk up from cwd (monorepos started one level above the app) looking for a config. */
async function findConfig(hostCwd: string, names: string[]): Promise<string | null> {
  let dir = hostCwd.replace(/\/+$/, '') || '/';
  for (let depth = 0; depth <= CONFIG_SEARCH_DEPTH; depth++) {
    const hit = await firstExisting(dir, names);
    if (hit) return hit;
    const parent = path.posix.dirname(dir);
    if (parent === dir || dir === '/') break;
    dir = parent;
  }
  return null;
}

async function packageVersion(cwd: string, pkg: string): Promise<number[] | null> {
  const file = await findConfig(cwd, [`node_modules/${pkg}/package.json`]);
  if (!file) return null;
  try {
    const v = JSON.parse(await readHostFile(file)).version as string;
    return v.split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  } catch { return null; }
}

export function processForDomain(domain: DomainMapping, procs: PortProcess[]): PortProcess | undefined {
  return procs.find((p) => p.listeners?.some((l) => l.port === domain.port))
    ?? procs.find((p) => p.ports?.includes(domain.port));
}

export interface CheckOptions {
  /** command line of a pid — the listener is often a child (`next-server`) */
  commandOf?: (pid: number) => Promise<string>;
}

interface Detected {
  framework: Framework;
  config: string | null;
  cmd: string;
}

async function detect(proc: PortProcess, opts: CheckOptions): Promise<Detected | null> {
  let cmd = `${proc.name} ${proc.cmd}`;
  // `next dev` / `nuxi dev` serve from a child process whose title hides the
  // subcommand; the parent's command line says which mode it really is.
  if (opts.commandOf && proc.ppid > 1) {
    const parent = await opts.commandOf(proc.ppid).catch(() => '');
    if (parent) cmd = `${cmd} ${parent}`;
  }
  for (const fw of FRAMEWORKS) {
    if (fw.cmd.test(cmd)) return { framework: fw, config: await findConfig(proc.cwd, fw.configNames), cmd };
  }
  // The command can be a generic runner (`node server.js`, `pnpm dev`): fall
  // back to whichever config file the folder has.
  for (const fw of FRAMEWORKS) {
    const config = await findConfig(proc.cwd, fw.configNames);
    if (config) return { framework: fw, config, cmd };
  }
  return null;
}

function hostFor(rule: HostRule, baseDomain: string): string {
  return rule.pattern === 'wildcard' ? `*.${baseDomain}` : `.${baseDomain}`;
}

interface Planned {
  check: DomainHostCheck;
  plan?: AllowedHostsPlan;
  original?: string;
}

async function planFor(domain: DomainMapping, procs: PortProcess[], baseDomain: string, opts: CheckOptions): Promise<Planned> {
  const base: DomainHostCheck = { applicable: false, blocked: false, autoFixable: false, changes: [], summary: '' };
  if (domain.processType === 'docker') {
    return { check: { ...base, summary: 'El destino es un contenedor: su configuración se revisa dentro de la imagen' } };
  }
  const proc = processForDomain(domain, procs);
  if (!proc?.cwd) return { check: { ...base, summary: 'No se encontró el proceso que atiende ese puerto' } };

  const found = await detect(proc, opts);
  if (!found) return { check: { ...base, summary: 'No se reconoce el framework: el dominio no necesita cambios conocidos' } };
  const { framework: fw, config, cmd } = found;
  const mode = fw.mode(cmd);
  const version = fw.id === 'next' ? await packageVersion(proc.cwd, 'next') : null;
  const rule = fw.rule(mode, version);
  const info = { framework: fw.id, frameworkLabel: fw.label, mode };

  if ('skip' in rule) return { check: { ...base, ...info, summary: rule.skip } };
  if ('manual' in rule) {
    return { check: { ...base, ...info, applicable: true, blocked: true, file: config ?? undefined, summary: rule.manual } };
  }
  const host = hostFor(rule, baseDomain);
  if (!config) {
    return {
      check: {
        ...base, ...info, applicable: true, blocked: true,
        summary: `${fw.label} no tiene archivo de configuración en la carpeta del proceso: hay que crearlo con ${[...rule.path, rule.prop].join('.')}`,
      },
    };
  }

  const original = await readHostFile(config);
  const plan = planAllowedHosts(original, { path: rule.path, prop: rule.prop, host });
  const check: DomainHostCheck = {
    ...info,
    applicable: true,
    file: config,
    host,
    blocked: !plan.allowed,
    autoFixable: plan.autoFixable && !plan.allowed,
    restartNeeded: !rule.reloadsItself,
    changes: plan.changes,
    diff: plan.patched ? diffLines(original, plan.patched) : undefined,
    summary: plan.allowed
      ? `${fw.label} ya permite ${host}`
      : plan.note || (fw.id === 'next'
        ? `Next.js en modo dev bloquea los recursos (HMR) de ${host}: hay que sumarlo a allowedDevOrigins`
        : `${fw.label} bloquea ${host}: hay que agregarlo a ${[...rule.path, rule.prop].join('.')}`),
  };
  return { check, plan, original };
}

/**
 * Inspect the process behind a published domain and report whether its
 * framework will reject the hostname, with the exact edit that fixes it.
 */
export async function checkDomainHost(
  domain: DomainMapping,
  procs: PortProcess[],
  baseDomain: string,
  opts: CheckOptions = {}
): Promise<DomainHostCheck> {
  return (await planFor(domain, procs, baseDomain, opts)).check;
}

/**
 * Apply the edit and, when asked (and needed), relaunch the process so the
 * change takes effect — preview servers read their config only at startup.
 */
export async function applyDomainHostFix(
  domain: DomainMapping,
  procs: PortProcess[],
  baseDomain: string,
  opts: CheckOptions & {
    restart?: boolean;
    write: (hostPath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
    restartProcess: (proc: PortProcess) => Promise<{ ok: boolean; pid?: number; error?: string }>;
  }
): Promise<HostFixResult> {
  const { check, plan, original } = await planFor(domain, procs, baseDomain, opts);
  if (!check.applicable) return { ok: false, error: check.summary };
  if (!check.blocked) return { ok: true, already: true, file: check.file };
  if (!check.autoFixable || !check.file || !plan?.patched || original === undefined) {
    return { ok: false, error: check.summary };
  }

  // The file may have changed between the modal and the click: re-read and
  // refuse rather than overwrite edits the user made meanwhile.
  const current = await readHostFile(check.file);
  if (current !== original) return { ok: false, error: 'El archivo cambió mientras tanto: volvé a abrir el aviso' };

  const written = await opts.write(check.file, plan.patched);
  if (!written.ok) return { ok: false, error: written.error || 'No se pudo escribir el archivo' };

  if (!opts.restart || !check.restartNeeded) return { ok: true, file: check.file, changes: plan.changes };
  const proc = processForDomain(domain, procs);
  if (!proc) return { ok: true, file: check.file, changes: plan.changes };
  const restart = await opts.restartProcess(proc);
  return { ok: true, file: check.file, changes: plan.changes, restart };
}
