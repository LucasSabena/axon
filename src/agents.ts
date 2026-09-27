import { Hono } from 'hono';
import {
  hostExec,
  hostSpawnInteractive,
  hostDirEntries,
  hostExists,
  readHostFile,
  readHostJson,
  HOST_USER,
} from './host';
import { detectPrograms, programById } from './programs';

// --- AI agents manager ---
// Inventory + management of AI coding agents installed on the host:
// detection, skills, MCP servers and plugins per agent, with enable/disable,
// delete and add operations applied to each agent's native config format.
//
// Toggle mechanisms (verified against the real config formats):
//   codex        config.toml → [mcp_servers.X]/[plugins."p@m"] enabled=bool,
//                skills via [[skills.config]] path=... enabled=bool
//   claude       settings.json enabledPlugins{"p@m":bool}; MCPs have no native
//                flag → entry is "parked" from mcpServers to _disabledMcpServers
//   opencode     opencode.json mcp.X.enabled bool; plugins disabled via '-'
//                prefix in cli.json plugins[]; file plugins (*.ts) renamed .off
//   cursor       mcp.json mcpServers.X.disabled bool
//   gemini       settings.json mcpServers (parked like claude)
//   antigravity  ~/.gemini/config/config.json plugins.<id>.enabled
//   devin/windsurf/antigravity-mcp  mcp_config.json mcpServers (serverUrl) parked
//   shared       ~/.agents/skills — SKILL.md ⇄ SKILL.md.off rename

export interface AgentItem {
  kind: 'skill' | 'mcp' | 'plugin' | 'provider';
  key: string;
  name: string;
  desc?: string;
  detail?: string;
  enabled: boolean;
  toggleable: boolean;
  deletable: boolean;
  scope?: string;
  linked?: string; // symlink target for skills installed via skills CLI
}

export interface AgentSummary {
  id: string;
  name: string;
  icon: string;
  brandIcon?: string;
  programId?: string;
  installed: boolean;
  version?: string;
  latestVersion?: string;
  auth?: { loggedIn: boolean; account?: string; canLogin: boolean; canLogout: boolean; loginHint?: string };
  counts: { skills: number; mcps: number; plugins: number };
  configRoot: string;
}

export interface AgentDetail extends AgentSummary {
  items: AgentItem[];
  notes?: string[];
}

// HOME expands lazily so tests/dev can override env.
const H = () => `/home/${HOST_USER}`;

interface AgentDef {
  id: string;
  name: string;
  icon: string;
  brandIcon?: string;
  programId?: string;
  bin?: string;
  configRoot: () => string;
  skillsDirs?: { path: () => string; scope: string; toggle: 'codex-toml' | 'rename' | 'none' }[];
  mcp?: { path: () => string; format: 'toml' | 'json-park' | 'opencode' | 'cursor' | 'serverurl' };
  plugins?: 'codex-toml' | 'claude' | 'opencode' | 'antigravity' | 'none';
  shared?: boolean;
}

const AGENTS: AgentDef[] = [
  {
    id: 'codex', name: 'Codex', icon: 'bot', brandIcon: '/icons/openai.svg', programId: 'codex',
    bin: 'codex', configRoot: () => `${H()}/.codex`,
    skillsDirs: [{ path: () => `${H()}/.codex/skills`, scope: 'user', toggle: 'codex-toml' }],
    mcp: { path: () => `${H()}/.codex/config.toml`, format: 'toml' },
    plugins: 'codex-toml',
  },
  {
    id: 'claude', name: 'Claude Code', icon: 'sparkles', brandIcon: '/icons/claudecode.svg', programId: 'claude-code',
    bin: 'claude', configRoot: () => `${H()}/.claude`,
    skillsDirs: [{ path: () => `${H()}/.claude/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { path: () => `${H()}/.claude.json`, format: 'json-park' },
    plugins: 'claude',
  },
  {
    id: 'devin', name: 'Devin', icon: 'brain-circuit', brandIcon: '/api/icons/devin-desktop', programId: 'devin',
    bin: 'devin', configRoot: () => `${H()}/.config/devin`,
    skillsDirs: [{ path: () => `${H()}/.config/devin/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { path: () => `${H()}/.config/devin/mcp_config.json`, format: 'serverurl' },
    plugins: 'none',
  },
  {
    id: 'opencode', name: 'OpenCode', icon: 'square-terminal', brandIcon: '/api/icons/ai.opencode.desktop', programId: 'opencode',
    bin: 'opencode', configRoot: () => `${H()}/.config/opencode`,
    skillsDirs: [{ path: () => `${H()}/.config/opencode/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { path: () => `${H()}/.config/opencode/opencode.json`, format: 'opencode' },
    plugins: 'opencode',
  },
  {
    id: 'gemini', name: 'Gemini CLI', icon: 'gem', brandIcon: '/icons/googlegemini.svg', programId: 'gemini',
    bin: 'gemini', configRoot: () => `${H()}/.gemini`,
    skillsDirs: [{ path: () => `${H()}/.gemini/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { path: () => `${H()}/.gemini/settings.json`, format: 'json-park' },
    plugins: 'none',
  },
  {
    id: 'antigravity', name: 'Antigravity', icon: 'rocket', bin: 'agy',
    configRoot: () => `${H()}/.gemini/config`,
    mcp: { path: () => `${H()}/.gemini/config/mcp_config.json`, format: 'serverurl' },
    plugins: 'antigravity',
  },
  {
    id: 'openchamber', name: 'OpenChamber', icon: 'brain', programId: 'openchamber',
    bin: 'openchamber', configRoot: () => `${H()}/.config/openchamber`,
    plugins: 'none',
  },
  {
    id: 'cursor', name: 'Cursor', icon: 'mouse-pointer-2',
    configRoot: () => `${H()}/.cursor`,
    skillsDirs: [{ path: () => `${H()}/.cursor/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { path: () => `${H()}/.cursor/mcp.json`, format: 'cursor' },
    plugins: 'none',
  },
  {
    id: 'windsurf', name: 'Windsurf', icon: 'waves', brandIcon: '/icons/windsurf.svg',
    bin: 'windsurf', configRoot: () => `${H()}/.codeium/windsurf`,
    mcp: { path: () => `${H()}/.codeium/windsurf/mcp_config.json`, format: 'serverurl' },
    plugins: 'none',
  },
  {
    id: 'shared', name: 'Compartidas', icon: 'users', shared: true,
    configRoot: () => `${H()}/.agents`,
    skillsDirs: [{ path: () => `${H()}/.agents/skills`, scope: 'compartida', toggle: 'rename' }],
  },
];

function agentById(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id);
}

// --- fs helpers (host fs mounted RO at /hostfs; writes go through hostExec) ---

const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

async function writeHostText(hostPath: string, content: string): Promise<{ ok: boolean; error?: string }> {
  await hostExec(`cp ${shq(hostPath)} ${shq(hostPath)}.pmbak 2>/dev/null`, { user: 'user', timeoutMs: 10_000 });
  const proc = hostSpawnInteractive(`cat > ${shq(hostPath)}`, { user: 'user' });
  const stdin = proc.stdin as { write(d: string | Uint8Array): unknown; flush(): unknown; end(): void };
  try {
    for (let off = 0; off < content.length; off += 1 << 20) {
      await stdin.write(content.slice(off, off + (1 << 20)));
    }
    await stdin.flush();
  } catch { /* redirect may have failed — reported via exit code */ }
  try { stdin.end(); } catch { /* already closed */ }
  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
  ]);
  return code === 0 ? { ok: true } : { ok: false, error: stderr.trim().slice(0, 400) || `exit ${code}` };
}

async function readText(hostPath: string): Promise<string | null> {
  try {
    return await readHostFile(hostPath);
  } catch {
    return null;
  }
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._@/ -]{0,120}$/;
const okKey = (s: string) => SAFE_KEY.test(s) && !s.includes('..');

// --- SKILL.md frontmatter ---

function parseSkillMeta(content: string): { name?: string; desc?: string } {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  const block = fm ? fm[1] : content.slice(0, 2000);
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const desc = block.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { name, desc };
}

// --- TOML section helpers (raw-text edits preserve comments/format) ---
// A TOML section header: [a.b] or [a."quoted key"] ; arrays: [[a.b]]

interface TomlSection { header: string; start: number; end: number; lines: string[] }

function tomlSections(text: string): TomlSection[] {
  const lines = text.split('\n');
  const sections: TomlSection[] = [];
  let cur: TomlSection | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\[{1,2})([^\]]+)\]{1,2}\s*(?:#.*)?$/);
    if (m) {
      if (cur) { cur.end = i; sections.push(cur); }
      cur = { header: m[2].trim(), start: i, end: lines.length, lines };
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

function tomlUnquote(key: string): string {
  const t = key.trim();
  const q = t.match(/^"(.*)"$/)?.[1] ?? t.match(/^'(.*)'$/)?.[1];
  return q ?? t;
}

// Parse the first key segment after `parent.` — handles bare names and
// quoted names (which may themselves contain dots, e.g. plugins."a@b").
// isSub=true when the header continues deeper ([parent.NAME.x]).
function tomlTableName(rest: string): { name: string; isSub: boolean } {
  const t = rest.trim();
  if (t.startsWith('"') || t.startsWith("'")) {
    const q = t[0];
    const end = t.indexOf(q, 1);
    if (end > 0) return { name: t.slice(1, end), isSub: t[end + 1] === '.' };
  }
  const dot = t.indexOf('.');
  return { name: dot < 0 ? t : t.slice(0, dot), isSub: dot >= 0 };
}

// Find sections [parent.NAME] and nested [parent.NAME.*]
function findTomlTable(sections: TomlSection[], parent: string, name: string): TomlSection[] {
  return sections.filter((s) => {
    if (!s.header.startsWith(parent + '.')) return false;
    return tomlTableName(s.header.slice(parent.length + 1)).name === name;
  });
}

function tomlSetEnabled(text: string, parent: string, name: string, enabled: boolean): string | null {
  const lines = text.split('\n');
  const secs = tomlSections(text);
  const main = findTomlTable(secs, parent, name).find(
    (s) => !tomlTableName(s.header.slice(parent.length + 1)).isSub
  );
  if (!main) return null;
  // search within [start+1, end) for an `enabled =` line
  for (let i = main.start + 1; i < main.end; i++) {
    if (/^\s*enabled\s*=/.test(lines[i])) {
      lines[i] = lines[i].replace(/=\s*(true|false)/, `= ${enabled}`);
      return lines.join('\n');
    }
  }
  lines.splice(main.start + 1, 0, `enabled = ${enabled}`);
  return lines.join('\n');
}

function tomlRemoveTable(text: string, parent: string, name: string): string | null {
  const lines = text.split('\n');
  const secs = findTomlTable(tomlSections(text), parent, name);
  if (!secs.length) return null;
  // remove from last to first to keep indexes valid
  const sorted = [...secs].sort((a, b) => b.start - a.start);
  for (const s of sorted) lines.splice(s.start, s.end - s.start);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// [[skills.config]] entries keyed by `path = "..."`
function tomlSkillConfigSet(text: string, skillPath: string, enabled: boolean): string {
  const lines = text.split('\n');
  const secs = tomlSections(text).filter((s) => s.header === 'skills.config');
  const escPath = skillPath.replace(/"/g, '\\"');
  for (const s of secs) {
    const body = lines.slice(s.start, s.end).join('\n');
    if (!new RegExp(`^\\s*path\\s*=\\s*"${skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'm').test(body)) continue;
    for (let i = s.start + 1; i < s.end; i++) {
      if (/^\s*enabled\s*=/.test(lines[i])) {
        lines[i] = lines[i].replace(/=\s*(true|false)/, `= ${enabled}`);
        return lines.join('\n');
      }
    }
    lines.splice(s.start + 1, 0, `enabled = ${enabled}`);
    return lines.join('\n');
  }
  return `${text.replace(/\s+$/, '')}\n\n[[skills.config]]\npath = "${escPath}"\nenabled = ${enabled}\n`;
}

function tomlSkillConfigRemove(text: string, skillPath: string): string {
  const lines = text.split('\n');
  const secs = tomlSections(text).filter((s) => s.header === 'skills.config');
  const re = new RegExp(`^\\s*path\\s*=\\s*"${skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'm');
  for (const s of [...secs].sort((a, b) => b.start - a.start)) {
    if (re.test(lines.slice(s.start, s.end).join('\n'))) lines.splice(s.start, s.end - s.start);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

// --- item scanners ---

async function scanSkills(def: AgentDef): Promise<AgentItem[]> {
  const items: AgentItem[] = [];
  for (const dir of def.skillsDirs ?? []) {
    const root = dir.path();
    const entries = await hostDirEntries(root);
    // codex keeps per-skill enabled flags in [[skills.config]] keyed by SKILL.md path
    let disabledPaths = new Set<string>();
    if (dir.toggle === 'codex-toml' && def.mcp?.format === 'toml') {
      const toml = (await readText(def.mcp.path())) ?? '';
      for (const s of tomlSections(toml)) {
        if (s.header !== 'skills.config') continue;
        const body = s.lines.slice(s.start, s.end).join('\n');
        const p = body.match(/^\s*path\s*=\s*"([^"]+)"/m)?.[1];
        const en = body.match(/^\s*enabled\s*=\s*(true|false)/m)?.[1];
        if (p && en === 'false') disabledPaths.add(p);
      }
    }
    for (const name of entries) {
      if (name.startsWith('.')) {
        if (name !== '.system') continue;
        // builtin/system skills: list read-only at reduced scope
        for (const sub of await hostDirEntries(`${root}/.system`)) {
          if (sub.startsWith('.')) continue;
          const meta = parseSkillMeta((await readText(`${root}/.system/${sub}/SKILL.md`)) ?? '');
          items.push({
            kind: 'skill', key: `.system/${sub}`, name: meta.name || sub, desc: meta.desc,
            enabled: true, toggleable: false, deletable: false, scope: 'sistema',
          });
        }
        continue;
      }
      const base = `${root}/${name}`;
      const linked = await hostExec(`readlink ${shq(base)}`, { user: 'user', timeoutMs: 5_000 });
      const linkTarget = linked.ok ? linked.stdout.trim() : undefined;
      const hasOn = await hostExists(`${base}/SKILL.md`);
      const hasOff = await hostExists(`${base}/SKILL.md.off`);
      if (!hasOn && !hasOff) {
        // plugin-cached dir or other content — skip non-skill entries quietly
        continue;
      }
      const meta = parseSkillMeta((await readText(`${base}/SKILL.md`)) ?? (await readText(`${base}/SKILL.md.off`)) ?? '');
      const tomlDisabled = dir.toggle === 'codex-toml' && disabledPaths.has(`${base}/SKILL.md`);
      items.push({
        kind: 'skill', key: name, name: meta.name || name, desc: meta.desc,
        detail: linkTarget ? `→ ${linkTarget}` : base,
        enabled: hasOn && !tomlDisabled,
        // codex toggles by path in config.toml — safe even on symlinked skills;
        // rename toggles must not touch a symlink's target dir.
        toggleable: dir.toggle === 'codex-toml' || (dir.toggle === 'rename' && !linkTarget),
        // linked skills: deleting removes only the link for this agent — allow it
        deletable: true,
        scope: dir.scope,
        linked: linkTarget,
      });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

function mcpTarget(s: Record<string, unknown>): string {
  const url = (s.url ?? s.serverUrl ?? s.httpUrl) as string | undefined;
  if (url) return url;
  const cmd = s.command as string | undefined;
  if (cmd) {
    const args = Array.isArray(s.args) ? (s.args as string[]).join(' ') : '';
    return `${cmd} ${args}`.trim().slice(0, 80);
  }
  if (Array.isArray(s.command)) return (s.command as string[]).join(' ').slice(0, 80);
  return '';
}

async function scanMcps(def: AgentDef): Promise<AgentItem[]> {
  const m = def.mcp;
  if (!m) return [];
  const items: AgentItem[] = [];
  if (m.format === 'toml') {
    const text = (await readText(m.path())) ?? '';
    const secs = tomlSections(text).filter((s) => s.header.startsWith('mcp_servers.') && s.header.split('.').length === 2);
    for (const s of secs) {
      const name = tomlUnquote(s.header.slice('mcp_servers.'.length));
      const body = s.lines.slice(s.start + 1, s.end).join('\n');
      const enabled = body.match(/^\s*enabled\s*=\s*(true|false)/m)?.[1] !== 'false';
      const url = body.match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1]
        ?? body.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1] ?? '';
      items.push({ kind: 'mcp', key: name, name, detail: url, enabled, toggleable: true, deletable: true });
    }
    return items;
  }
  const json = await readHostJson<Record<string, unknown>>(m.path());
  if (!json) return items;
  if (m.format === 'opencode') {
    const mcp = (json.mcp ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, s] of Object.entries(mcp)) {
      items.push({
        kind: 'mcp', key: name, name, detail: mcpTarget(s),
        enabled: s.enabled !== false, toggleable: true, deletable: true,
      });
    }
    return items;
  }
  const servers = (json.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
  const parked = (json._disabledMcpServers ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, s] of Object.entries(servers)) {
    const enabled = m.format === 'cursor' ? s.disabled !== true : true;
    items.push({ kind: 'mcp', key: name, name, detail: mcpTarget(s), enabled, toggleable: true, deletable: true });
  }
  if (m.format === 'json-park' || m.format === 'serverurl') {
    for (const [name, s] of Object.entries(parked)) {
      items.push({ kind: 'mcp', key: name, name, detail: mcpTarget(s), enabled: false, toggleable: true, deletable: true });
    }
  }
  return items;
}

async function scanPlugins(def: AgentDef): Promise<AgentItem[]> {
  const items: AgentItem[] = [];
  if (def.plugins === 'codex-toml') {
    const text = (await readText(def.mcp!.path())) ?? '';
    for (const s of tomlSections(text)) {
      const m = s.header.match(/^plugins\."(.+)"$/);
      if (!m) continue;
      const body = s.lines.slice(s.start + 1, s.end).join('\n');
      const [name, mkt] = m[1].split('@');
      items.push({
        kind: 'plugin', key: m[1], name, scope: mkt,
        enabled: body.match(/^\s*enabled\s*=\s*(true|false)/m)?.[1] !== 'false',
        toggleable: true, deletable: true,
      });
    }
    return items;
  }
  if (def.plugins === 'claude') {
    const settings = await readHostJson<{ enabledPlugins?: Record<string, boolean> }>(`${H()}/.claude/settings.json`);
    const installed = await readHostJson<{ plugins?: Record<string, { installPath?: string; version?: string }[]> }>(
      `${H()}/.claude/plugins/installed_plugins.json`
    );
    for (const [key, on] of Object.entries(settings?.enabledPlugins ?? {})) {
      const [name, mkt] = key.split('@');
      const inst = installed?.plugins?.[key]?.[0];
      items.push({
        kind: 'plugin', key, name, scope: mkt, detail: inst?.version ? `v${inst.version}` : undefined,
        enabled: on === true, toggleable: true, deletable: true,
      });
    }
    return items;
  }
  if (def.plugins === 'opencode') {
    const root = `${H()}/.config/opencode`;
    const cli = await readHostJson<{ plugins?: string[] }>(`${root}/cli.json`);
    const listed = new Map<string, boolean>(); // name → enabled
    for (const entry of cli?.plugins ?? []) {
      const disabled = entry.startsWith('-');
      const p = disabled ? entry.slice(1) : entry;
      listed.set(p.split('/').pop() || p, !disabled);
    }
    for (const f of await hostDirEntries(`${root}/plugins`)) {
      const m = f.match(/^(.+)\.ts(\.off)?$/);
      const name = m ? m[1] : f.includes('.') ? null : f;
      if (!name || name === 'node_modules') continue;
      const cliState = listed.get(name);
      items.push({
        kind: 'plugin', key: name, name, scope: m ? 'archivo' : 'local',
        detail: `${root}/plugins/${f}`,
        enabled: cliState ?? !f.endsWith('.off'),
        toggleable: true, deletable: true,
      });
    }
    for (const [name, enabled] of listed) {
      if (!items.some((i) => i.key === name)) {
        items.push({ kind: 'plugin', key: name, name, scope: 'cli', enabled, toggleable: true, deletable: true });
      }
    }
    return items;
  }
  if (def.plugins === 'antigravity') {
    const cfg = await readHostJson<{ plugins?: Record<string, { enabled?: boolean }> }>(`${H()}/.gemini/config/config.json`);
    for (const [id, p] of Object.entries(cfg?.plugins ?? {})) {
      const name = id.split('.').pop() || id;
      items.push({
        kind: 'plugin', key: id, name, scope: 'antigravity',
        enabled: p.enabled !== false, toggleable: true, deletable: true,
      });
    }
    return items;
  }
  return items;
}

// --- auth / providers (reuse program auth checks where defined) ---

async function agentAuth(def: AgentDef): Promise<AgentSummary['auth']> {
  const prog = def.programId ? programById(def.programId) : undefined;
  if (!prog?.auth) return undefined;
  const a = await hostExec(prog.auth.check.cmd, { user: prog.auth.check.user, timeoutMs: 15_000 });
  return {
    loggedIn: a.ok && a.stdout.trim().length > 0,
    account: a.ok ? a.stdout.trim().split('\n')[0] || undefined : undefined,
    canLogin: !!prog.auth.login,
    canLogout: !!prog.auth.logout,
    loginHint: prog.auth.loginHint,
  };
}

async function scanProviders(def: AgentDef): Promise<AgentItem[]> {
  const items: AgentItem[] = [];
  if (def.id === 'opencode') {
    const auth = await readHostJson<Record<string, { type?: string }>>(`${H()}/.local/share/opencode/auth.json`);
    const acc = await readHostJson<{ accounts?: Record<string, { serviceID?: string; credential?: { type?: string } }>; active?: Record<string, string> }>(
      `${H()}/.local/share/opencode/account.json`
    );
    const seen = new Set<string>();
    for (const [prov, v] of Object.entries(auth ?? {})) {
      seen.add(prov);
      items.push({ kind: 'provider', key: prov, name: prov, detail: v?.type || 'credenciales guardadas', enabled: true, toggleable: false, deletable: false });
    }
    for (const [id, a] of Object.entries(acc?.accounts ?? {})) {
      const prov = a?.serviceID || id;
      if (seen.has(prov)) continue;
      items.push({ kind: 'provider', key: prov, name: prov, detail: a?.credential?.type === 'oauth' ? 'oauth' : 'api key', enabled: true, toggleable: false, deletable: false });
    }
    return items;
  }
  if (def.id === 'codex') {
    const auth = await readHostJson<{ auth_mode?: string; tokens?: { id_token?: string; access_token?: string } }>(`${H()}/.codex/auth.json`);
    if (auth) {
      let account: string | undefined;
      const tok = auth.tokens?.id_token || auth.tokens?.access_token;
      try {
        const payload = JSON.parse(Buffer.from((tok || '').split('.')[1] || '', 'base64url').toString());
        account = payload.email || payload['https://api.openai.com/auth']?.user_email;
      } catch { /* token unreadable */ }
      items.push({ kind: 'provider', key: 'openai', name: auth.auth_mode === 'chatgpt' ? 'OpenAI (ChatGPT)' : 'OpenAI API', detail: account, enabled: true, toggleable: false, deletable: false });
    }
    return items;
  }
  if (def.id === 'claude') {
    const d = await readHostJson<{ oauthAccount?: { emailAddress?: string; organizationName?: string } }>(`${H()}/.claude.json`);
    if (d?.oauthAccount?.emailAddress) {
      items.push({
        kind: 'provider', key: 'anthropic', name: 'Anthropic',
        detail: [d.oauthAccount.emailAddress, d.oauthAccount.organizationName].filter(Boolean).join(' · '),
        enabled: true, toggleable: false, deletable: false,
      });
    }
    return items;
  }
  if (def.id === 'openchamber') {
    const gh = await readHostJson<{ user?: string; login?: string }>(`${H()}/.config/openchamber/github-auth.json`);
    if (gh) items.push({ kind: 'provider', key: 'github', name: 'GitHub', detail: gh.user || gh.login, enabled: true, toggleable: false, deletable: false });
    return items;
  }
  return items;
}

// --- public API ---

export async function listAgents(): Promise<AgentSummary[]> {
  // versions/auth come from the programs registry scan (single parallel pass)
  const progViews = new Map((await detectPrograms()).map((p) => [p.id, p]));

  return Promise.all(
    AGENTS.map(async (def) => {
      const prog = def.programId ? progViews.get(def.programId) : undefined;
      const hasBin = def.bin ? (await hostExec(`command -v ${def.bin}`, { user: 'user', timeoutMs: 10_000 })).ok : false;
      const hasConfig = await hostExists(def.configRoot());
      const installed = def.shared ? hasConfig : hasBin || hasConfig;
      const [skills, mcps, plugins] = installed
        ? await Promise.all([scanSkills(def), scanMcps(def), scanPlugins(def)])
        : [[], [], []];
      let version = prog?.version;
      if (!version && def.bin && hasBin) {
        const v = await hostExec(`${def.bin} --version 2>/dev/null | head -1`, { user: 'user', timeoutMs: 15_000 });
        if (v.ok) version = v.stdout.trim().split('\n')[0] || undefined;
      }
      return {
        id: def.id, name: def.name, icon: def.icon, brandIcon: def.brandIcon,
        programId: def.programId, installed,
        version, latestVersion: prog?.latestVersion,
        auth: prog?.auth ?? (installed ? await agentAuth(def) : undefined),
        counts: { skills: skills.length, mcps: mcps.length, plugins: plugins.length },
        configRoot: def.configRoot(),
      };
    })
  );
}

export async function agentDetail(id: string): Promise<AgentDetail | null> {
  const def = agentById(id);
  if (!def) return null;
  const hasBin = def.bin ? (await hostExec(`command -v ${def.bin}`, { user: 'user', timeoutMs: 10_000 })).ok : false;
  const hasConfig = await hostExists(def.configRoot());
  const installed = def.shared ? hasConfig : hasBin || hasConfig;
  const prog = def.programId ? programById(def.programId) : undefined;
  const [skills, mcps, plugins, providers] = await Promise.all([
    scanSkills(def), scanMcps(def), scanPlugins(def), scanProviders(def),
  ]);
  let version: string | undefined;
  if (hasBin) {
    const cmd = prog?.version?.cmd ?? `${def.bin} --version 2>/dev/null | head -1`;
    const v = await hostExec(cmd, { user: prog?.version?.user ?? 'user', timeoutMs: 15_000 });
    if (v.ok) version = v.stdout.trim().split('\n')[0] || undefined;
  }
  const notes: string[] = [];
  if (def.shared) notes.push('Estas skills las ven todos los agentes — desactivar o borrar acá afecta a todos.');
  if (def.mcp && (def.mcp.format === 'json-park' || def.mcp.format === 'serverurl'))
    notes.push('Este agente no tiene flag nativo para MCPs: al desactivar, la entrada se mueve a "_disabledMcpServers" (reversible, no se pierde la config).');
  return {
    id: def.id, name: def.name, icon: def.icon, brandIcon: def.brandIcon,
    programId: def.programId, installed, version,
    auth: installed ? await agentAuth(def) : undefined,
    counts: { skills: skills.length, mcps: mcps.length, plugins: plugins.length },
    configRoot: def.configRoot(),
    items: [...providers, ...skills, ...mcps, ...plugins],
    notes,
  };
}

// --- mutations ---

const NAME_OK = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

async function toggleMcp(def: AgentDef, key: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const m = def.mcp!;
  if (m.format === 'toml') {
    const text = await readText(m.path());
    if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
    const out = tomlSetEnabled(text, 'mcp_servers', key, enabled);
    if (out == null) return { ok: false, error: `MCP "${key}" no encontrado` };
    return writeHostText(m.path(), out);
  }
  const json = await readHostJson<Record<string, unknown>>(m.path());
  if (!json) return { ok: false, error: `No se pudo leer ${m.path()}` };
  if (m.format === 'opencode') {
    const mcp = (json.mcp ?? {}) as Record<string, Record<string, unknown>>;
    if (!mcp[key]) return { ok: false, error: `MCP "${key}" no encontrado` };
    mcp[key].enabled = enabled;
    json.mcp = mcp;
    return writeHostText(m.path(), JSON.stringify(json, null, 2) + '\n');
  }
  if (m.format === 'cursor') {
    const servers = (json.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
    if (!servers[key]) return { ok: false, error: `MCP "${key}" no encontrado` };
    servers[key].disabled = !enabled;
    json.mcpServers = servers;
    return writeHostText(m.path(), JSON.stringify(json, null, 2) + '\n');
  }
  // json-park / serverurl: move entry between mcpServers ⇄ _disabledMcpServers
  const servers = (json.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
  const parked = (json._disabledMcpServers ?? {}) as Record<string, Record<string, unknown>>;
  const from = enabled ? parked : servers;
  const to = enabled ? servers : parked;
  if (!from[key]) return { ok: false, error: `MCP "${key}" no encontrado` };
  to[key] = from[key];
  delete from[key];
  json.mcpServers = servers;
  if (Object.keys(parked).length) json._disabledMcpServers = parked;
  else delete json._disabledMcpServers;
  return writeHostText(m.path(), JSON.stringify(json, null, 2) + '\n');
}

async function togglePlugin(def: AgentDef, key: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (def.plugins === 'codex-toml') {
    const path = def.mcp!.path();
    const text = await readText(path);
    if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
    const out = tomlSetEnabled(text, 'plugins', key, enabled);
    if (out == null) return { ok: false, error: `Plugin "${key}" no encontrado` };
    return writeHostText(path, out);
  }
  if (def.plugins === 'claude') {
    const path = `${H()}/.claude/settings.json`;
    const json = (await readHostJson<Record<string, unknown>>(path)) ?? {};
    const ep = (json.enabledPlugins ?? {}) as Record<string, boolean>;
    if (!(key in ep)) return { ok: false, error: `Plugin "${key}" no encontrado` };
    ep[key] = enabled;
    json.enabledPlugins = ep;
    return writeHostText(path, JSON.stringify(json, null, 2) + '\n');
  }
  if (def.plugins === 'opencode') {
    const root = `${H()}/.config/opencode`;
    // file-based plugin: plugins/<name>.ts ⇄ .ts.off ; dir plugin ⇄ dir.off
    const tsPath = `${root}/plugins/${key}.ts`;
    const offPath = `${tsPath}.off`;
    if ((await hostExists(tsPath)) || (await hostExists(offPath))) {
      const from = enabled ? offPath : tsPath;
      const to = enabled ? tsPath : offPath;
      const r = await hostExec(`mv ${shq(from)} ${shq(to)}`, { user: 'user', timeoutMs: 10_000 });
      return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(0, 300) };
    }
    // cli.json plugins array: '-' prefix disables
    const cliPath = `${root}/cli.json`;
    const cli = await readHostJson<{ plugins?: string[] }>(cliPath);
    if (!cli?.plugins) return { ok: false, error: `Plugin "${key}" no encontrado` };
    const idx = cli.plugins.findIndex((e) => (e.startsWith('-') ? e.slice(1) : e).split('/').pop() === key);
    if (idx < 0) return { ok: false, error: `Plugin "${key}" no encontrado` };
    const cur = cli.plugins[idx];
    cli.plugins[idx] = enabled ? cur.replace(/^-/, '') : (cur.startsWith('-') ? cur : `-${cur}`);
    return writeHostText(cliPath, JSON.stringify(cli, null, 2) + '\n');
  }
  if (def.plugins === 'antigravity') {
    const path = `${H()}/.gemini/config/config.json`;
    const json = (await readHostJson<Record<string, unknown>>(path)) ?? {};
    const plugins = (json.plugins ?? {}) as Record<string, { enabled?: boolean }>;
    if (!plugins[key]) return { ok: false, error: `Plugin "${key}" no encontrado` };
    plugins[key].enabled = enabled;
    json.plugins = plugins;
    return writeHostText(path, JSON.stringify(json, null, 2) + '\n');
  }
  return { ok: false, error: 'Este agente no soporta gestión de plugins' };
}

async function toggleSkill(def: AgentDef, key: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const dir = def.skillsDirs?.[0];
  if (!dir) return { ok: false, error: 'Sin carpeta de skills' };
  const base = `${dir.path()}/${key}`;
  if (dir.toggle === 'codex-toml') {
    const path = def.mcp!.path();
    const text = await readText(path);
    if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
    const out = tomlSkillConfigSet(text, `${base}/SKILL.md`, enabled);
    return writeHostText(path, out);
  }
  const on = `${base}/SKILL.md`;
  const off = `${base}/SKILL.md.off`;
  const from = enabled ? off : on;
  const to = enabled ? on : off;
  if (!(await hostExists(from))) return { ok: false, error: `Skill "${key}" no encontrada` };
  const r = await hostExec(`mv ${shq(from)} ${shq(to)}`, { user: 'user', timeoutMs: 10_000 });
  return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(0, 300) };
}

async function deleteItem(def: AgentDef, kind: string, key: string): Promise<{ ok: boolean; error?: string }> {
  if (kind === 'skill') {
    const dir = def.skillsDirs?.[0];
    if (!dir || !okKey(key) || key.includes('/')) return { ok: false, error: 'Skill inválida' };
    const base = `${dir.path()}/${key}`;
    const r = await hostExec(`rm -rf ${shq(base)}`, { user: 'user', timeoutMs: 15_000 });
    if (!r.ok) return { ok: false, error: r.stderr.slice(0, 300) };
    // clean a stale codex [[skills.config]] entry if present
    if (dir.toggle === 'codex-toml') {
      const path = def.mcp!.path();
      const text = await readText(path);
      if (text != null) await writeHostText(path, tomlSkillConfigRemove(text, `${base}/SKILL.md`));
    }
    return { ok: true };
  }
  if (kind === 'mcp') {
    const m = def.mcp!;
    if (m.format === 'toml') {
      const text = await readText(m.path());
      if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
      const out = tomlRemoveTable(text, 'mcp_servers', key);
      if (out == null) return { ok: false, error: `MCP "${key}" no encontrado` };
      return writeHostText(m.path(), out);
    }
    const json = await readHostJson<Record<string, unknown>>(m.path());
    if (!json) return { ok: false, error: `No se pudo leer ${m.path()}` };
    const bucket = m.format === 'opencode' ? 'mcp' : 'mcpServers';
    const servers = (json[bucket] ?? {}) as Record<string, unknown>;
    const parked = (json._disabledMcpServers ?? {}) as Record<string, unknown>;
    if (!(key in servers) && !(key in parked)) return { ok: false, error: `MCP "${key}" no encontrado` };
    delete servers[key];
    delete parked[key];
    json[bucket] = servers;
    if (Object.keys(parked).length) json._disabledMcpServers = parked;
    else delete json._disabledMcpServers;
    return writeHostText(m.path(), JSON.stringify(json, null, 2) + '\n');
  }
  if (kind === 'plugin') {
    if (def.plugins === 'codex-toml') {
      const path = def.mcp!.path();
      const text = await readText(path);
      if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
      const out = tomlRemoveTable(text, 'plugins', key);
      if (out == null) return { ok: false, error: `Plugin "${key}" no encontrado` };
      return writeHostText(path, out);
    }
    if (def.plugins === 'claude') {
      const sPath = `${H()}/.claude/settings.json`;
      const settings = (await readHostJson<Record<string, unknown>>(sPath)) ?? {};
      const ep = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
      delete ep[key];
      settings.enabledPlugins = ep;
      const w1 = await writeHostText(sPath, JSON.stringify(settings, null, 2) + '\n');
      if (!w1.ok) return w1;
      const iPath = `${H()}/.claude/plugins/installed_plugins.json`;
      const inst = await readHostJson<{ plugins?: Record<string, unknown> }>(iPath);
      if (inst?.plugins && key in inst.plugins) {
        delete inst.plugins[key];
        await writeHostText(iPath, JSON.stringify(inst, null, 2) + '\n');
      }
      return { ok: true };
    }
    if (def.plugins === 'opencode') {
      const root = `${H()}/.config/opencode`;
      const r = await hostExec(`rm -rf ${shq(`${root}/plugins/${key}`)} ${shq(`${root}/plugins/${key}.ts`)} ${shq(`${root}/plugins/${key}.ts.off`)} 2>/dev/null`, { user: 'user', timeoutMs: 15_000 });
      const cliPath = `${root}/cli.json`;
      const cli = await readHostJson<{ plugins?: string[] }>(cliPath);
      if (cli?.plugins) {
        const next = cli.plugins.filter((e) => (e.startsWith('-') ? e.slice(1) : e).split('/').pop() !== key);
        if (next.length !== cli.plugins.length) {
          cli.plugins = next;
          await writeHostText(cliPath, JSON.stringify(cli, null, 2) + '\n');
        }
      }
      return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(0, 300) };
    }
    if (def.plugins === 'antigravity') {
      const path = `${H()}/.gemini/config/config.json`;
      const json = (await readHostJson<Record<string, unknown>>(path)) ?? {};
      const plugins = (json.plugins ?? {}) as Record<string, unknown>;
      if (!(key in plugins)) return { ok: false, error: `Plugin "${key}" no encontrado` };
      delete plugins[key];
      json.plugins = plugins;
      return writeHostText(path, JSON.stringify(json, null, 2) + '\n');
    }
    return { ok: false, error: 'Este agente no soporta gestión de plugins' };
  }
  return { ok: false, error: 'Tipo desconocido' };
}

async function addSkill(def: AgentDef, name: string, desc: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const dir = def.skillsDirs?.[0];
  if (!dir) return { ok: false, error: 'Este agente no tiene carpeta de skills gestionable' };
  if (!NAME_OK.test(name)) return { ok: false, error: 'Nombre inválido (usá letras, números, . _ -)' };
  const base = `${dir.path()}/${name}`;
  if (await hostExists(base)) return { ok: false, error: 'Ya existe una skill con ese nombre' };
  const md = `---\nname: ${name}\ndescription: ${desc || `Skill ${name}`}\n---\n\n${body || `# ${name}\n`}\n`;
  const r = await hostExec(`mkdir -p ${shq(base)}`, { user: 'user', timeoutMs: 10_000 });
  if (!r.ok) return { ok: false, error: r.stderr.slice(0, 300) };
  return writeHostText(`${base}/SKILL.md`, md);
}

async function addMcp(def: AgentDef, name: string, url: string, command: string, args: string): Promise<{ ok: boolean; error?: string }> {
  const m = def.mcp;
  if (!m) return { ok: false, error: 'Este agente no tiene config de MCPs gestionable' };
  if (!okKey(name)) return { ok: false, error: 'Nombre inválido' };
  if (!url && !command) return { ok: false, error: 'Indicá una URL (remoto) o un comando (stdio)' };
  if (url && !/^https?:\/\//.test(url)) return { ok: false, error: 'La URL debe empezar con http(s)://' };

  if (m.format === 'toml') {
    const text = (await readText(m.path())) ?? '';
    const exists = findTomlTable(tomlSections(text), 'mcp_servers', name).length > 0;
    if (exists) return { ok: false, error: 'Ya existe un MCP con ese nombre' };
    const block = url
      ? `\n[mcp_servers.${JSON.stringify(name)}]\nurl = ${JSON.stringify(url)}\n`
      : `\n[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(command)}\n${args ? `args = [${args.split(/\s+/).map((a) => JSON.stringify(a)).join(', ')}]\n` : ''}`;
    return writeHostText(m.path(), text.replace(/\s+$/, '') + '\n' + block);
  }

  const json = (await readHostJson<Record<string, unknown>>(m.path())) ?? {};
  const entry: Record<string, unknown> = url
    ? (m.format === 'serverurl' ? { serverUrl: url } : { url })
    : { command, ...(args ? { args: args.split(/\s+/) } : {}) };
  if (m.format === 'opencode') {
    const mcp = (json.mcp ?? {}) as Record<string, unknown>;
    if (mcp[name]) return { ok: false, error: 'Ya existe un MCP con ese nombre' };
    mcp[name] = url ? { type: 'remote', url, enabled: true } : { type: 'local', command: [command, ...(args ? args.split(/\s+/) : [])], enabled: true };
    json.mcp = mcp;
    return writeHostText(m.path(), JSON.stringify(json, null, 2) + '\n');
  }
  const servers = (json.mcpServers ?? {}) as Record<string, unknown>;
  if (servers[name]) return { ok: false, error: 'Ya existe un MCP con ese nombre' };
  servers[name] = entry;
  json.mcpServers = servers;
  return writeHostText(m.path(), JSON.stringify(json, null, 2) + '\n');
}

// --- routes ---

export function registerAgentRoutes(app: Hono): void {
  app.get('/api/agents', async (c) => {
    const agents = await listAgents();
    return c.json({ ok: true, agents });
  });

  app.get('/api/agents/:id', async (c) => {
    const detail = await agentDetail(c.req.param('id'));
    if (!detail) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    return c.json({ ok: true, agent: detail });
  });

  app.post('/api/agents/:id/toggle', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { kind, key, enabled } = await c.req.json<{ kind: string; key: string; enabled: boolean }>().catch(() => ({ kind: '', key: '', enabled: false }));
    if (!okKey(key)) return c.json({ ok: false, error: 'Clave inválida' }, 400);
    const r =
      kind === 'mcp' ? await toggleMcp(def, key, !!enabled)
      : kind === 'plugin' ? await togglePlugin(def, key, !!enabled)
      : kind === 'skill' ? await toggleSkill(def, key, !!enabled)
      : { ok: false, error: 'Tipo desconocido' };
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents/:id/delete', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { kind, key } = await c.req.json<{ kind: string; key: string }>().catch(() => ({ kind: '', key: '' }));
    if (!okKey(key)) return c.json({ ok: false, error: 'Clave inválida' }, 400);
    const r = await deleteItem(def, kind, key);
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents/:id/add-skill', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { name, desc, body } = await c.req.json<{ name: string; desc?: string; body?: string }>().catch(() => ({ name: '' }));
    const r = await addSkill(def, name || '', desc || '', body || '');
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents/:id/add-mcp', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { name, url, command, args } = await c.req.json<{ name: string; url?: string; command?: string; args?: string }>().catch(() => ({ name: '' }));
    const r = await addMcp(def, name || '', url || '', command || '', args || '');
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });
}
