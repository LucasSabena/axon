import { resolveHostPath, projectSearchRoots } from './host-storage';
import { Hono, type Context } from 'hono';
import { body as readBody } from './storage/http';
import { readFile, writeFile, mkdir, stat, rename } from 'fs/promises';
import { hostToContainer } from './host';
import { recordEvent } from './events';
import { SnapshotCache } from './snapshot-cache';
import { registerAgentArchives } from './agent-archives';
import { registerAgentContext } from './agent-context';
import * as path from 'path';
import {
  hostExec,
  hostSpawnInteractive,
  hostDirEntries,
  hostExists,
  readHostFile,
  readHostJson,
  HOST_USER,
} from './host';
import { getPrograms, peekPrograms, programById } from './programs';
import { getProjectScanDirs, getProjects } from './projects';

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
//   opencode     opencode.jsonc + opencode.json merged — mcp.X.enabled bool;
//                plugins disabled via '-' prefix in cli.json plugins[];
//                file plugins (*.ts) renamed .off
//   openchamber  runs on opencode — shares its MCP pool; own plugins live in
//                opencode.managed.json ('-' prefix disables)
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
  file?: string;   // host path of the backing file (SKILL.md, config file…)
  url?: string;    // remote endpoint for http MCP servers (health-checkable)
  hasKey?: boolean;   // providers: a usable API key exists (raw or env-resolvable)
  copyable?: boolean; // providers: descriptor is complete enough to copy
  raw?: Record<string, unknown>; // sanitized raw config for the detail drawer
}

export interface AgentSummary {
  id: string;
  name: string;
  icon: string;
  brandIcon?: string;
  iconKey?: string; // slug for /api/brandicon lookups (bin name or id)
  programId?: string;
  installed: boolean;
  residual?: boolean; // config dir exists but no binary/.desktop — leftover of an uninstalled app
  provWritable?: boolean; // can receive copied providers (known config format)
  custom?: boolean; // registered by hand / from discovery — removable
  version?: string;
  latestVersion?: string;
  auth?: { loggedIn: boolean; account?: string; canLogin: boolean; canLogout: boolean; loginHint?: string };
  counts: { skills: number; mcps: number; plugins: number };
  configRoot: string;
  hasConfig?: boolean; // editable scalar settings file exists
}

export interface AgentDetail extends AgentSummary {
  items: AgentItem[];
  notes?: string[];
}

// HOME expands lazily so tests/dev can override env.
const H = () => HOST_USER === 'root' ? '/root' : `/home/${HOST_USER}`;

interface AgentDef {
  id: string;
  name: string;
  icon: string;
  brandIcon?: string;
  programId?: string;
  bin?: string;
  desktopNames?: string[]; // .desktop basenames (GUI apps without a CLI bin)
  configRoot: () => string;
  skillsDirs?: { path: () => string; scope: string; toggle: 'codex-toml' | 'rename' | 'none' }[];
  // paths[0] is the primary file — new entries are written there; entries
  // present in several files are merged (first file wins for display state)
  // and edits apply to every file that contains the key.
  // key: the JSON property holding the server map — 'mcpServers' for most
  // agents, 'context_servers' for Zed, etc. Parked entries go to
  // `_disabled<Key>` on disable (agent ignores the unknown key).
  mcp?: { paths: () => string[]; format: 'toml' | 'json-park' | 'opencode' | 'cursor' | 'serverurl'; key?: string };
  plugins?: 'codex-toml' | 'claude' | 'opencode' | 'openchamber' | 'antigravity' | 'none';
  configFile?: () => string; // file backing the visual "Config" tab
  shared?: boolean;
  custom?: boolean;
  notes?: string[];
}

const AGENTS: AgentDef[] = [
  {
    id: 'codex', name: 'Codex', icon: 'bot', brandIcon: '/icons/openai.svg', programId: 'codex',
    bin: 'codex', configRoot: () => `${H()}/.codex`,
    skillsDirs: [{ path: () => `${H()}/.codex/skills`, scope: 'user', toggle: 'codex-toml' }],
    mcp: { paths: () => [`${H()}/.codex/config.toml`], format: 'toml' },
    plugins: 'codex-toml',
    configFile: () => `${H()}/.codex/config.toml`,
  },
  {
    id: 'claude', name: 'Claude Code', icon: 'sparkles', brandIcon: '/icons/claudecode.svg', programId: 'claude-code',
    bin: 'claude', configRoot: () => `${H()}/.claude`,
    skillsDirs: [{ path: () => `${H()}/.claude/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.claude.json`], format: 'json-park' },
    plugins: 'claude',
    configFile: () => `${H()}/.claude/settings.json`,
  },
  {
    id: 'devin', name: 'Devin', icon: 'brain-circuit', brandIcon: '/api/icons/devin-desktop', programId: 'devin',
    bin: 'devin', desktopNames: ['devin-desktop'],
    configRoot: () => `${H()}/.config/devin`,
    skillsDirs: [{ path: () => `${H()}/.config/devin/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.config/devin/mcp_config.json`], format: 'serverurl' },
    plugins: 'none',
    configFile: () => `${H()}/.config/devin/config.json`,
  },
  {
    id: 'opencode', name: 'OpenCode', icon: 'square-terminal', brandIcon: '/api/icons/ai.opencode.desktop', programId: 'opencode',
    bin: 'opencode', configRoot: () => `${H()}/.config/opencode`,
    skillsDirs: [{ path: () => `${H()}/.config/opencode/skills`, scope: 'user', toggle: 'rename' }],
    // opencode merges opencode.jsonc + opencode.json (jsonc is primary here)
    mcp: { paths: () => [`${H()}/.config/opencode/opencode.jsonc`, `${H()}/.config/opencode/opencode.json`], format: 'opencode' },
    plugins: 'opencode',
    configFile: () => `${H()}/.config/opencode/opencode.jsonc`,
  },
  {
    id: 'gemini', name: 'Gemini CLI', icon: 'gem', brandIcon: '/icons/googlegemini.svg', programId: 'gemini',
    bin: 'gemini', configRoot: () => `${H()}/.gemini`,
    skillsDirs: [{ path: () => `${H()}/.gemini/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.gemini/settings.json`], format: 'json-park' },
    plugins: 'none',
    configFile: () => `${H()}/.gemini/settings.json`,
  },
  {
    id: 'antigravity', name: 'Antigravity', icon: 'rocket', bin: 'agy',
    configRoot: () => `${H()}/.gemini/config`,
    mcp: { paths: () => [`${H()}/.gemini/config/mcp_config.json`], format: 'serverurl' },
    plugins: 'antigravity',
    configFile: () => `${H()}/.gemini/config/config.json`,
  },
  {
    id: 'openchamber', name: 'OpenChamber', icon: 'brain', programId: 'openchamber',
    bin: 'openchamber', configRoot: () => `${H()}/.config/openchamber`,
    // OpenChamber is a UI on top of opencode — same MCP pool.
    mcp: { paths: () => [`${H()}/.config/opencode/opencode.jsonc`, `${H()}/.config/opencode/opencode.json`], format: 'opencode' },
    plugins: 'openchamber',
    configFile: () => `${H()}/.config/openchamber/settings.json`,
    notes: ['OpenChamber corre sobre OpenCode — sus MCPs son los de opencode (opencode.jsonc + opencode.json).'],
  },
  {
    id: 'cursor', name: 'Cursor', icon: 'mouse-pointer-2', brandIcon: '/icons/cursor.svg',
    desktopNames: ['cursor', 'Cursor'],
    configRoot: () => `${H()}/.cursor`,
    skillsDirs: [{ path: () => `${H()}/.cursor/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.cursor/mcp.json`], format: 'cursor' },
    plugins: 'none',
  },
  {
    id: 'windsurf', name: 'Windsurf', icon: 'waves', brandIcon: '/icons/windsurf.svg',
    bin: 'windsurf', desktopNames: ['windsurf', 'com.codeium.windsurf'],
    configRoot: () => `${H()}/.codeium/windsurf`,
    mcp: { paths: () => [`${H()}/.codeium/windsurf/mcp_config.json`], format: 'serverurl' },
    plugins: 'none',
  },
  {
    id: 'vscode', name: 'VS Code', icon: 'code', brandIcon: '/api/brandicon/vscode',
    bin: 'code', desktopNames: ['com.microsoft.VSCode', 'code', 'code-oss'],
    configRoot: () => `${H()}/.config/Code`,
    mcp: { paths: () => [`${H()}/.config/Code/User/mcp.json`], format: 'json-park', key: 'servers' },
    plugins: 'none',
    configFile: () => `${H()}/.config/Code/User/settings.json`,
    notes: ['VS Code guarda MCPs en User/mcp.json bajo la clave "servers" (formato propio).'],
  },
  {
    id: 'copilot', name: 'GitHub Copilot', icon: 'bot', brandIcon: '/icons/githubcopilot.svg',
    bin: 'copilot', configRoot: () => `${H()}/.copilot`,
    skillsDirs: [{ path: () => `${H()}/.copilot/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.copilot/mcp-config.json`], format: 'json-park' },
    plugins: 'none',
    configFile: () => `${H()}/.copilot/mcp-config.json`,
  },
  {
    id: 'claude-desktop', name: 'Claude Desktop', icon: 'message-square', brandIcon: '/icons/claude.svg',
    desktopNames: ['com.anthropic.Claude', 'claude-desktop', 'Claude'],
    configRoot: () => `${H()}/.config/Claude`,
    mcp: { paths: () => [`${H()}/.config/Claude/claude_desktop_config.json`], format: 'json-park' },
    plugins: 'none',
    configFile: () => `${H()}/.config/Claude/claude_desktop_config.json`,
  },
  {
    id: 'zed', name: 'Zed', icon: 'zap', brandIcon: '/icons/zedindustries.svg',
    bin: 'zed', desktopNames: ['dev.zed.Zed', 'zed'],
    configRoot: () => `${H()}/.config/zed`,
    mcp: { paths: () => [`${H()}/.config/zed/settings.json`], format: 'json-park', key: 'context_servers' },
    plugins: 'none',
    configFile: () => `${H()}/.config/zed/settings.json`,
  },
  {
    id: 'ollama', name: 'Ollama', icon: 'server', brandIcon: '/icons/ollama.svg',
    bin: 'ollama', configRoot: () => `${H()}/.ollama`,
    plugins: 'none',
    notes: ['Runtime de modelos, no agente de código — Ollama Cloud usa el mismo binario y config (~/.ollama, `ollama signin`).'],
  },
  {
    id: 'pi', name: 'Pi', icon: 'terminal',
    bin: 'pi', configRoot: () => `${H()}/.pi`,
    skillsDirs: [{ path: () => `${H()}/.pi/agent/skills`, scope: 'user', toggle: 'rename' }],
    plugins: 'none',
  },
  {
    id: 'hermes', name: 'Hermes', icon: 'feather',
    bin: 'hermes', configRoot: () => `${H()}/.hermes`,
    skillsDirs: [{ path: () => `${H()}/.hermes/skills`, scope: 'user', toggle: 'rename' }],
    plugins: 'none',
    configFile: () => `${H()}/.hermes/config.yaml`,
  },
  {
    id: 'commandcode', name: 'CommandCode', icon: 'square-terminal',
    bin: 'commandcode', configRoot: () => `${H()}/.commandcode`,
    skillsDirs: [{ path: () => `${H()}/.commandcode/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.commandcode/settings.json`], format: 'json-park' },
    plugins: 'none',
    configFile: () => `${H()}/.commandcode/settings.json`,
  },
  {
    id: 'grok', name: 'Grok CLI', icon: 'zap',
    bin: 'grok', configRoot: () => `${H()}/.grok`,
    skillsDirs: [{ path: () => `${H()}/.grok/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.grok/config.toml`], format: 'toml' },
    plugins: 'none',
    configFile: () => `${H()}/.grok/config.toml`,
  },
  {
    id: 'kimi', name: 'Kimi Code', icon: 'moon', brandIcon: '/icons/kimi.svg',
    bin: 'kimi', configRoot: () => `${H()}/.kimi-code`,
    mcp: { paths: () => [`${H()}/.kimi-code/config.toml`], format: 'toml' },
    plugins: 'none',
    configFile: () => `${H()}/.kimi-code/config.toml`,
  },
  {
    id: 'qwen', name: 'Qwen Code', icon: 'bot', brandIcon: '/icons/qwen.svg',
    bin: 'qwen', configRoot: () => `${H()}/.qwen`,
    skillsDirs: [{ path: () => `${H()}/.qwen/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.qwen/settings.json`], format: 'json-park' },
    plugins: 'none',
    configFile: () => `${H()}/.qwen/settings.json`,
  },
  {
    id: 'factory', name: 'Factory Droid', icon: 'factory',
    bin: 'droid', configRoot: () => `${H()}/.factory`,
    skillsDirs: [{ path: () => `${H()}/.factory/skills`, scope: 'user', toggle: 'rename' }],
    mcp: { paths: () => [`${H()}/.factory/mcp.json`], format: 'json-park' },
    plugins: 'none',
    configFile: () => `${H()}/.factory/settings.json`,
  },
  {
    id: 'kiro', name: 'Kiro', icon: 'ghost',
    bin: 'kiro', desktopNames: ['kiro'],
    configRoot: () => `${H()}/.kiro`,
    skillsDirs: [{ path: () => `${H()}/.kiro/skills`, scope: 'user', toggle: 'rename' }],
    plugins: 'none',
  },
  {
    id: 'slate', name: 'Slate', icon: 'layers',
    bin: 'slate', configRoot: () => `${H()}/.slate`,
    skillsDirs: [{ path: () => `${H()}/.slate/skills`, scope: 'user', toggle: 'rename' }],
    plugins: 'none',
  },
  {
    id: 'openclaude', name: 'OpenClaude', icon: 'terminal',
    bin: 'openclaude', configRoot: () => `${H()}/.openclaude`,
    mcp: { paths: () => [`${H()}/.openclaude/settings.json`], format: 'json-park' },
    plugins: 'none',
    configFile: () => `${H()}/.openclaude/settings.json`,
  },
  {
    id: 'amp', name: 'Amp', icon: 'zap',
    bin: 'amp', configRoot: () => `${H()}/.config/amp`,
    plugins: 'none',
  },
  {
    id: 'goose', name: 'Goose', icon: 'feather',
    bin: 'goose', configRoot: () => `${H()}/.config/goose`,
    plugins: 'none',
    configFile: () => `${H()}/.config/goose/config.yaml`,
  },
  {
    id: 'aider', name: 'Aider', icon: 'terminal',
    bin: 'aider', configRoot: () => `${H()}/.aider`,
    plugins: 'none',
    configFile: () => `${H()}/.aider.conf.yml`,
  },
  {
    id: 'openclaw', name: 'OpenClaw', icon: 'paw-print',
    bin: 'openclaw', configRoot: () => `${H()}/.openclaw`,
    skillsDirs: [{ path: () => `${H()}/.openclaw/skills`, scope: 'user', toggle: 'rename' }],
    plugins: 'none',
    configFile: () => `${H()}/.openclaw/openclaw.json`,
  },
  {
    id: 'zcode', name: 'ZCode', icon: 'bot',
    bin: 'zcode', desktopNames: ['zcode', 'ZCode', 'com.zai.zcode'],
    configRoot: () => `${H()}/.zcode`,
    plugins: 'none',
    notes: ['Entorno de escritorio de Z.ai para GLM (Coding Plan o BYOK).'],
  },
  {
    id: 'deepseek-harness', name: 'DeepSeek Harness', icon: 'bot', brandIcon: '/icons/deepseek.svg',
    bin: 'dsh', configRoot: () => `${H()}/.dsh`,
    plugins: 'none',
  },
  {
    id: 'mcode', name: 'MiniMax Code', icon: 'terminal', brandIcon: '/icons/minimax.svg',
    bin: 'mcode', configRoot: () => `${H()}/.minimax`,
    plugins: 'none',
    configFile: () => `${H()}/.minimax/config.yaml`,
  },
  {
    id: 'mmx', name: 'MiniMax CLI', icon: 'terminal', brandIcon: '/icons/minimax.svg',
    bin: 'mmx', configRoot: () => `${H()}/.minimax`,
    plugins: 'none',
    notes: ['CLI multimodal de MiniMax (texto/imagen/video/audio) — comparte config con MiniMax Code.'],
  },
  {
    id: 'opendesign', name: 'OpenDesign', icon: 'palette',
    // su CLI se llama `od` — colisiona con coreutils, así que solo se
    // detecta por config dir / .desktop, no por PATH
    desktopNames: ['open-design', 'OpenDesign'],
    configRoot: () => `${H()}/.open-design`,
    plugins: 'none',
    notes: ['Workspace de diseño que orquesta los CLIs instalados — no es un agente en sí.'],
  },
  {
    id: 'kilocode', name: 'Kilo Code', icon: 'terminal',
    bin: 'kilocode', configRoot: () => `${H()}/.kilocode`,
    plugins: 'none',
  },
  {
    id: 'qoder', name: 'Qoder', icon: 'terminal',
    bin: 'qoder', configRoot: () => `${H()}/.qoder`,
    plugins: 'none',
  },
  {
    id: 'trae', name: 'Trae', icon: 'terminal', brandIcon: '/icons/trae.svg',
    bin: 'trae-cli', desktopNames: ['trae', 'Trae'],
    configRoot: () => `${H()}/.trae`,
    plugins: 'none',
  },
  {
    id: 'codebuddy', name: 'CodeBuddy', icon: 'terminal', brandIcon: '/icons/codebuddy.svg',
    bin: 'codebuddy', configRoot: () => `${H()}/.codebuddy`,
    plugins: 'none',
  },
  {
    id: 'jules', name: 'Jules', icon: 'sparkles',
    bin: 'jules', configRoot: () => `${H()}/.jules`,
    plugins: 'none',
  },
  {
    id: 'lmstudio', name: 'LM Studio', icon: 'server', brandIcon: '/icons/lmstudio.svg',
    bin: 'lms', desktopNames: ['lm-studio', 'LM-Studio', 'lmstudio'],
    configRoot: () => `${H()}/.lmstudio`,
    plugins: 'none',
    notes: ['Runtime local de modelos — server OpenAI-compatible en :1234.'],
  },
  {
    id: 'shared', name: 'Compartidas', icon: 'users', shared: true,
    configRoot: () => `${H()}/.agents`,
    skillsDirs: [{ path: () => `${H()}/.agents/skills`, scope: 'compartida', toggle: 'rename' }],
  },
];

// --- custom agents (manually registered / promoted from discovery) ---
// Persisted in agents-custom.json next to config.json. The config layout
// (which file holds MCPs, whether a skills/ dir exists) is sniffed once at
// registration and stored, so custom agents get the same management surface
// as built-ins on a best-effort basis.

type McpFormat = NonNullable<AgentDef['mcp']>['format'];

interface CustomAgentRec {
  id: string;
  name: string;
  bin?: string;
  configRoot: string;
  mcpPaths?: string[];
  mcpFormat?: McpFormat;
  mcpKey?: string;
  hasSkills?: boolean;
}

const CUSTOM_FILE = path.join(
  path.dirname(process.env.CONFIG_PATH || '/app/data/config.json'),
  'agents-custom.json'
);

let customRecs: CustomAgentRec[] = [];
let dismissedDirs = new Set<string>();
let customDefs: AgentDef[] = [];

const CUSTOM_NAME_OK = /^[\w áéíóúñü.-]{1,60}$/i;
const CUSTOM_BIN_OK = /^[a-zA-Z0-9._-]{1,64}$/;

function recToDef(rec: CustomAgentRec): AgentDef {
  return {
    id: rec.id,
    name: rec.name,
    icon: 'bot',
    bin: rec.bin,
    configRoot: () => rec.configRoot,
    skillsDirs: rec.hasSkills
      ? [{ path: () => `${rec.configRoot}/skills`, scope: 'user', toggle: 'rename' }]
      : undefined,
    mcp: rec.mcpPaths?.length && rec.mcpFormat
      ? { paths: () => rec.mcpPaths!, format: rec.mcpFormat, key: rec.mcpKey }
      : undefined,
    plugins: 'none',
    custom: true,
    notes: ['Registrado a mano — el formato de config se detectó automáticamente y la gestión es best-effort.'],
  };
}

function rebuildCustomDefs(): void {
  customDefs = customRecs.map(recToDef);
}

let customWriteQ: Promise<void> = Promise.resolve();
function saveCustom(): Promise<void> {
  customWriteQ = customWriteQ.then(async () => {
    try {
      await mkdir(path.dirname(CUSTOM_FILE), { recursive: true });
      // tmp+rename — a crash mid-write must not leave a half-truncated
      // registry that the loader then parses as "no custom agents".
      const tmp = `${CUSTOM_FILE}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(
        tmp,
        JSON.stringify({ agents: customRecs, dismissed: [...dismissedDirs] }, null, 2)
      );
      await rename(tmp, CUSTOM_FILE);
    } catch { /* best-effort */ }
  });
  return customWriteQ;
}

async function loadCustom(): Promise<void> {
  try {
    const obj = JSON.parse(await readFile(CUSTOM_FILE, 'utf-8'));
    if (Array.isArray(obj?.agents)) {
      customRecs = obj.agents.filter(
        // Re-validate on load: a tampered agents-custom.json must not flow
        // unquoted into `command -v <bin>` shell calls.
        (r: CustomAgentRec) => r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.configRoot === 'string'
          && (r.bin === undefined || (typeof r.bin === 'string' && CUSTOM_BIN_OK.test(r.bin)))
      );
    }
    if (Array.isArray(obj?.dismissed)) dismissedDirs = new Set(obj.dismissed.filter((d: unknown) => typeof d === 'string'));
  } catch { /* missing/corrupt — start empty */ }
  rebuildCustomDefs();
}

await loadCustom();

function allDefs(): AgentDef[] {
  return customDefs.length ? [...AGENTS, ...customDefs] : AGENTS;
}

// Metadata only: no credential files or native agent processes are consulted.
export function agentPathReferences(){
  return allDefs().flatMap(def=>[...new Set([def.configRoot(),...(def.mcp?.paths()||[]),...(def.skillsDirs||[]).map(d=>d.path())])].map(p=>({title:`Agente: ${def.name}`,path:p,tree:true,detail:'Su configuración seguirá buscando en el origen. Moverla puede impedir acceder a sus cuentas, skills o MCP; revisá la ruta del agente después del movimiento.'})));
}

function agentById(id: string): AgentDef | undefined {
  return allDefs().find((a) => a.id === id);
}

// --- layout sniffing ---
// Given a config dir, figure out which known format its MCP config follows
// and whether it has a skills dir. Used both to describe discovery
// candidates and to build a manageable AgentDef when registering one.

interface AgentLayout {
  mcpPaths?: string[];
  mcpFormat?: McpFormat;
  mcpKey?: string;
  hasSkills: boolean;
  markers: string[];
}

async function sniffAgentLayout(root: string): Promise<AgentLayout> {
  const markers: string[] = [];
  const out: AgentLayout = { hasSkills: false, markers };

  // single shell pass: which candidate config files exist + skills dir check
  const probe = await hostExec(
    `d=${shq(root)}; ` +
    `for f in config.toml mcp.json mcp_config.json mcp-servers.json settings.json config.json opencode.jsonc opencode.json cli.json; do ` +
    `[ -f "$d/$f" ] && printf '%s\\n' "$f"; done; ` +
    `if [ -d "$d/skills" ] && find "$d/skills" -mindepth 2 -maxdepth 2 -name 'SKILL.md' -print -quit 2>/dev/null | grep -q .; then echo '__skills__'; fi`,
    { user: 'user', timeoutMs: 15_000 }
  );
  const have = new Set(probe.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
  if (have.delete('__skills__')) { out.hasSkills = true; markers.push('skills'); }

  // toml: [mcp_servers.X] sections
  if (have.has('config.toml')) {
    const text = await readText(`${root}/config.toml`);
    if (text && /^\s*\[mcp_servers[.\]]/m.test(text)) {
      out.mcpPaths = [`${root}/config.toml`];
      out.mcpFormat = 'toml';
      markers.push('mcp:config.toml');
      return out;
    }
  }

  // opencode-style: "mcp" key in opencode.jsonc/json
  const ocPaths = [`${root}/opencode.jsonc`, `${root}/opencode.json`].filter((p) => have.has(p.split('/').pop()!));
  for (const p of ocPaths) {
    const json = await readJsonFile(p);
    if (json?.mcp && typeof json.mcp === 'object' && Object.keys(json.mcp as object).length) {
      out.mcpPaths = ocPaths;
      out.mcpFormat = 'opencode';
      markers.push(`mcp:${p.split('/').pop()}`);
      return out;
    }
  }

  // generic JSON with "mcpServers" object (cursor mcp.json, windsurf
  // mcp_config.json, settings.json…) — parked to _disabledMcpServers on
  // disable, a reversible convention unknown agents simply won't read.
  for (const f of ['mcp.json', 'mcp_config.json', 'mcp-servers.json', 'settings.json', 'config.json', 'cli.json']) {
    if (!have.has(f)) continue;
    const json = await readJsonFile(`${root}/${f}`);
    for (const k of ['mcpServers', 'context_servers', 'contextServers']) {
      const srv = json?.[k];
      if (srv && typeof srv === 'object' && Object.keys(srv as object).length) {
        out.mcpPaths = [`${root}/${f}`];
        out.mcpFormat = 'json-park';
        out.mcpKey = k;
        markers.push(`mcp:${f}`);
        return out;
      }
    }
  }
  return out;
}

// --- heuristic discovery ---
// Scan ~/.config/* and ~/.<dotdir>* for dirs that look like an agent's config:
// an MCP config file, a skills/ dir with SKILL.md files, or an agent-ish name
// holding config files. Dirs already claimed by a known/custom agent and dirs
// the user dismissed are skipped. This is a *candidate* list — the user
// confirms before anything becomes a managed agent.

const AGENTISH_NAME = /agent|claude|codex|cursor|gemini|copilot|aider|cline|roo|windsurf|devin|opencode|goose|crush|qwen|kiro|trae|hermes|augment|continue|codeium|kimi|grok|factory|droid|slate|zed|kilocode|amp\b|openclaw|antigrav|jules|vibe|openhands|sweep|mcode|dsh|zcode|opendesign|qoder|codebuddy|minimax|lmstudio|ollama|pi\b|openclaude|commandcode|openchamber/i;

export interface DiscoveredAgent {
  dir: string;
  name: string;
  markers: string[];
  hasBin: boolean;
}

export async function discoverAgents(): Promise<DiscoveredAgent[]> {
  const claimed = new Set(allDefs().map((d) => d.configRoot()));
  const candidates=(await projectSearchRoots(getProjectScanDirs())).flatMap(root=>[`${shq(root)}/*/`,`${shq(root)}/.[!.]*/`,`${shq(root)}/.config/*/`]);
  const scan = await hostExec(
    `for d in "$HOME"/.config/*/ "$HOME"/.[!.]*/ ${candidates.join(' ')}; do ` +
    `[ -d "$d" ] || continue; d="\${d%/}"; hit=""; ` +
    `for f in mcp.json mcp_config.json mcp-servers.json; do ` +
    `[ -f "$d/$f" ] && hit="$hit mcp:$f"; done; ` +
    `for f in settings.json config.json config.toml opencode.jsonc opencode.json; do ` +
    `if [ -f "$d/$f" ] && grep -qiE '"mcpServers"|"mcp"[[:space:]]*:|"context_?[Ss]ervers"|\\[mcp_servers' "$d/$f" 2>/dev/null; then hit="$hit mcp:$f"; fi; done; ` +
    `if [ -d "$d/skills" ] && find "$d/skills" -mindepth 2 -maxdepth 2 -name 'SKILL.md' -print -quit 2>/dev/null | grep -q .; then hit="$hit skills"; fi; ` +
    `b="\${d##*/}"; ` +
    `if [ -z "$hit" ]; then ` +
    `for f in settings.json config.json config.toml auth.json credentials.json cli.json AGENTS.md CLAUDE.md; do ` +
    `[ -f "$d/$f" ] && hit="$hit cfg" && break; done; fi; ` +
    `bin=0; command -v "\${b#.}" >/dev/null 2>&1 && bin=1; ` +
    `[ -n "$hit" ] && printf '%s\\t%s\\t%s\\t%s\\n' "$d" "$b" "$hit" "$bin"; ` +
    `done`,
    { user: 'user', timeoutMs: 30_000 }
  );
  const out: DiscoveredAgent[] = [];
  const seen = new Set<string>(); // overlapping roots can list a dir twice
  for (const line of scan.stdout.split('\n').filter(Boolean)) {
    const [dir, name, raw, bin] = line.split('\t');
    if (!dir || !name || claimed.has(dir) || dismissedDirs.has(dir) || seen.has(dir)) continue;
    seen.add(dir);
    const markers = raw.trim().split(/\s+/).filter(Boolean);
    // weak "cfg" signal alone: only keep if the dir name looks agent-ish or
    // it has a matching binary — otherwise every app config would qualify.
    const strong = markers.some((m) => m !== 'cfg');
    if (!strong && !AGENTISH_NAME.test(name) && bin !== '1') continue;
    if (!strong && markers.length) markers.push('nombre/config');
    out.push({ dir, name, markers, hasBin: bin === '1' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// --- custom agent registration ---

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'agente';
}

// Serialize registrations: the uniqueness check + sniff + push must be
// atomic or two concurrent POSTs can both pass the check and duplicate.
let addCustomQ: Promise<unknown> = Promise.resolve();

async function addCustomAgent(name: string, dir: string, bin: string): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!CUSTOM_NAME_OK.test(name)) return { ok: false, error: 'Nombre inválido' };
  if (bin && !CUSTOM_BIN_OK.test(bin)) return { ok: false, error: 'Binario inválido' };
  const home = H();
  if (dir.startsWith('~/')) dir = `${home}/${dir.slice(2)}`;
  if (dir) {
    try{dir=await resolveHostPath(dir,{directory:true});}catch(e){return {ok:false,error:e instanceof Error?e.message:'Carpeta no disponible'};}
    if (!(await hostExists(dir))) return { ok: false, error: `No existe ${dir}` };
  }
  // no dir given: default to the conventional ~/.config/<slug> (may not exist
  // yet — the agent still counts as installed if its binary is on PATH)
  const slug = slugify(name);
  const configRoot = dir || `${home}/.config/${slug}`;
  const task = addCustomQ.then(async (): Promise<{ ok: boolean; error?: string; id?: string }> => {
    if (allDefs().some((d) => d.id === `custom-${slug}` || d.configRoot() === configRoot)) {
      return { ok: false, error: 'Ya hay un agente con ese nombre o carpeta' };
    }
    const layout = await sniffAgentLayout(configRoot);
    const rec: CustomAgentRec = {
      id: `custom-${slug}`,
      name,
      bin: bin || undefined,
      configRoot,
      mcpPaths: layout.mcpPaths,
      mcpFormat: layout.mcpFormat,
      mcpKey: layout.mcpKey,
      hasSkills: layout.hasSkills,
    };
    customRecs.push(rec);
    rebuildCustomDefs();
    dismissedDirs.delete(configRoot);
    await saveCustom();
    invalidateAgentsCache();
    return { ok: true, id: rec.id };
  });
  addCustomQ = task.then(() => undefined, () => undefined);
  return task;
}

async function removeCustomAgent(id: string): Promise<{ ok: boolean; error?: string }> {
  const idx = customRecs.findIndex((r) => r.id === id);
  if (idx < 0) return { ok: false, error: 'No es un agente registrado a mano' };
  dismissedDirs.add(customRecs[idx].configRoot); // don't resurface in discovery
  customRecs.splice(idx, 1);
  rebuildCustomDefs();
  await saveCustom();
  invalidateAgentsCache();
  return { ok: true };
}

async function dismissCandidate(dir: string): Promise<{ ok: boolean; error?: string }> {
  const home = H();
  try{dir=await resolveHostPath(dir,{directory:true});}catch{return {ok:false,error:'Directorio no disponible'};}
  dismissedDirs.add(dir);
  await saveCustom();
  invalidateAgentsCache(); // drops the dismissed row from the cached discovery list
  return { ok: true };
}

// --- fs helpers (host fs mounted RO at /hostfs; writes go through hostExec) ---

const shq = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;

// Serialize read-modify-write cycles per file so concurrent toggles/settings
// can't interleave and lose each other's edits (reuse of customWriteQ style).
const fileWriteQ = new Map<string, Promise<unknown>>();
async function withFileLocks<T>(paths: string[], work: () => Promise<T>): Promise<T> {
  const keys = [...new Set(paths)].sort();
  const prevs = keys.map((k) => fileWriteQ.get(k) ?? Promise.resolve());
  const run = Promise.all(prevs.map((p) => p.catch(() => undefined))).then(work);
  const tail = run.then(() => undefined, () => undefined);
  for (const k of keys) fileWriteQ.set(k, tail);
  void tail.then(() => { for (const k of keys) if (fileWriteQ.get(k) === tail) fileWriteQ.delete(k); });
  return run;
}

async function writeHostText(hostPath: string, content: string): Promise<{ ok: boolean; error?: string }> {
  try{hostPath=await resolveHostPath(hostPath);}catch(e){return {ok:false,error:e instanceof Error?e.message:'Disco no disponible'};}
  await hostExec(`cp ${shq(hostPath)} ${shq(hostPath)}.axonbak 2>/dev/null`, { user: 'user', timeoutMs: 10_000 });
  // Write to a temp sibling and rename: an interrupted `cat >` would leave a
  // truncated config, while mv is atomic on the same filesystem.
  const tmp = `${hostPath}.axontmp-${process.pid}-${Date.now().toString(36)}`;
  const proc = hostSpawnInteractive(`cat > ${shq(tmp)} && mv -f ${shq(tmp)} ${shq(hostPath)}; rc=$?; rm -f ${shq(tmp)} 2>/dev/null; exit $rc`, { user: 'user' });
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
    await resolveHostPath(hostPath);
    return await readHostFile(hostPath);
  } catch {
    return null;
  }
}

// JSONC-tolerant JSON read: opencode.jsonc may carry // and /* */ comments.
// stripJsonComments is string-aware so URLs like "http://…" survive intact.
function stripJsonComments(text: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  return out;
}

async function readJsonFile(hostPath: string): Promise<Record<string, unknown> | null> {
  const text = await readText(hostPath);
  if (text == null) return null;
  try { return JSON.parse(stripJsonComments(text)); } catch { return null; }
}

// --- JSONC-preserving edits ---
// opencode.jsonc may carry // and /* */ comments; a blanket JSON.stringify on
// mutation would destroy them. Instead, diff old/new documents and splice
// each changed value into the original text (like tomlSetScalar does for
// TOML). Unparseable shapes fall back to a full rewrite.

interface JNode { s: number; e: number; entries?: { key: string; ks: number; node: JNode }[] }

function skipJsoncWs(text: string, i: number): number {
  for (;;) {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
    if (text[i] === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (text[i] === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
    return i;
  }
}

function parseJsoncNode(text: string): JNode | null {
  let i = 0;
  const str = (): string | null => {
    if (text[i] !== '"') return null;
    let out = '';
    i++;
    while (i < text.length && text[i] !== '"') {
      const c = text[i];
      if (c === '\\') {
        const esc = text[i + 1];
        if (esc === 'u') { out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16) || 0); i += 6; continue; }
        out += { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[esc] ?? esc;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    i++;
    return out;
  };
  const val = (): JNode | null => {
    i = skipJsoncWs(text, i);
    const s = i;
    const c = text[i];
    if (c === '{') {
      i++;
      const entries: NonNullable<JNode['entries']> = [];
      if (text[skipJsoncWs(text, i)] === '}') { i = skipJsoncWs(text, i) + 1; return { s, e: i, entries }; }
      for (;;) {
        i = skipJsoncWs(text, i);
        const ks = i;
        const key = str();
        if (key == null) return null;
        i = skipJsoncWs(text, i);
        if (text[i] !== ':') return null;
        i++;
        const node = val();
        if (!node) return null;
        entries.push({ key, ks, node });
        i = skipJsoncWs(text, i);
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { s, e: i, entries }; }
        return null;
      }
    }
    if (c === '[') {
      i++;
      let depth = 1;
      while (i < text.length && depth) {
        const ch = text[i];
        if (ch === '"') { i++; while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1; i++; continue; }
        if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
        if (ch === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 2; continue; }
        if (ch === '[' || ch === '{') depth++;
        else if (ch === ']' || ch === '}') depth--;
        i++;
      }
      return depth ? null : { s, e: i };
    }
    if (c === '"') { if (str() == null) return null; return { s, e: i }; }
    const m = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^true|^false|^null/.exec(text.slice(i));
    if (!m) return null;
    i += m[0].length;
    return { s, e: i };
  };
  const root = val();
  return root && skipJsoncWs(text, i) === text.length ? root : null;
}

const JSONC_REMOVE = Symbol('jsonc-remove');

// Replace/insert/remove the value at a key path inside an object document.
// Returns null when the file shape can't be navigated positionally.
function jsoncEdit(text: string, path: string[], value: unknown): string | null {
  if (!path.length || path.some((s) => !s)) return null;
  const root = parseJsoncNode(text);
  if (!root?.entries) return null;
  let obj = root;
  for (const seg of path.slice(0, -1)) {
    const ent = obj.entries!.find((e) => e.key === seg);
    if (!ent?.node.entries) return null;
    obj = ent.node;
  }
  const key = path[path.length - 1];
  const entries = obj.entries!;
  const idx = entries.findIndex((e) => e.key === key);
  if (value === JSONC_REMOVE) {
    if (idx < 0) return text;
    const ent = entries[idx];
    let s = ent.ks;
    let e = ent.node.e;
    if (idx < entries.length - 1) {
      e = skipJsoncWs(text, e);
      if (text[e] === ',') e++;
    } else if (idx > 0) {
      // last member — remove the comma before it (keeps trailing comments)
      const prevEnd = entries[idx - 1].node.e;
      const comma = text.lastIndexOf(',', s);
      if (comma > prevEnd) s = comma;
    } else {
      const after = skipJsoncWs(text, e);
      if (text[after] === ',') e = after + 1;
    }
    return text.slice(0, s) + text.slice(e);
  }
  const lit = JSON.stringify(value);
  if (idx >= 0) return text.slice(0, entries[idx].node.s) + lit + text.slice(entries[idx].node.e);
  // insert as the last member, matching the file's own indentation
  const member = `${JSON.stringify(key)}: ${lit}`;
  if (!entries.length) return `${text.slice(0, obj.s + 1)}${member}${text.slice(obj.e - 1)}`;
  const last = entries[entries.length - 1];
  const gap = text.slice(obj.s + 1, entries[0].ks);
  const sep = gap.match(/\n[ \t]*$/)?.[0] ?? (gap.trim() ? ' ' : gap || ' ');
  const comma = text[skipJsoncWs(text, last.node.e)] === ',' ? '' : ',';
  return `${text.slice(0, last.node.e)}${comma}${sep}${member}${text.slice(last.node.e)}`;
}

// Flatten the object-level differences between two parsed documents into a
// list of (key path → new value | JSONC_REMOVE) edits.
function diffJson(before: unknown, after: unknown, path: string[], out: { path: string[]; value: unknown }[]): void {
  if (before === after) return;
  const bObj = before !== null && typeof before === 'object' && !Array.isArray(before);
  const aObj = after !== null && typeof after === 'object' && !Array.isArray(after);
  if (bObj && aObj) {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    for (const k of Object.keys(a)) diffJson(b[k], a[k], [...path, k], out);
    for (const k of Object.keys(b)) if (!(k in a)) out.push({ path: [...path, k], value: JSONC_REMOVE });
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path, value: after });
}

// Write a JSON document; for .jsonc, splice just the changed values into the
// existing text so comments and formatting survive. Falls back to a full
// rewrite when the file can't be navigated positionally.
async function writeJsonDoc(hostPath: string, json: unknown): Promise<{ ok: boolean; error?: string }> {
  if (hostPath.endsWith('.jsonc')) {
    const prev = await readText(hostPath);
    let before: unknown = null;
    if (prev != null) { try { before = JSON.parse(stripJsonComments(prev)); } catch { before = null; } }
    if (prev != null && before && typeof before === 'object') {
      const edits: { path: string[]; value: unknown }[] = [];
      diffJson(before, json, [], edits);
      let text: string | null = prev;
      for (const ed of edits) text = text == null ? null : jsoncEdit(text, ed.path, ed.value);
      if (text != null) return writeHostText(hostPath, text);
    }
  }
  return writeHostText(hostPath, JSON.stringify(json, null, 2) + '\n');
}

// A leading '@' covers npm-scoped ids (@org/plugin) — still no leading
// dots/underscores so __proto__ and dot-segments stay out.
const SAFE_KEY = /^@?[a-zA-Z0-9][a-zA-Z0-9._@/ -]{0,120}$/;
const okKey = (s: string) => SAFE_KEY.test(s) && !s.includes('..');

// --- SKILL.md frontmatter ---

function yamlScalar(v: string): string {
  const t = v.trim();
  const q = t.match(/^"(.*)"$/)?.[1] ?? t.match(/^'(.*)'$/)?.[1];
  return q ?? t;
}

function parseSkillMeta(content: string): { name?: string; desc?: string } {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  const block = fm ? fm[1] : content.slice(0, 2000);
  const lines = block.split('\n');
  const grab = (key: string): string | undefined => {
    const i = lines.findIndex((l) => new RegExp(`^${key}:\\s*`).test(l));
    if (i < 0) return undefined;
    const rest = lines[i].slice(lines[i].indexOf(':') + 1).trim();
    // YAML folded/literal block scalar: value lives in the indented lines below
    if (/^[>|][+-]?$/.test(rest)) {
      const out: string[] = [];
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) out.push(lines[j].trim());
      return out.join(' ').slice(0, 500) || undefined;
    }
    return rest ? yamlScalar(rest) : undefined;
  };
  return { name: grab('name'), desc: grab('description') };
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
      const toml = (await readText(def.mcp.paths()[0])) ?? '';
      for (const s of tomlSections(toml)) {
        if (s.header !== 'skills.config') continue;
        const body = s.lines.slice(s.start, s.end).join('\n');
        const p = body.match(/^\s*path\s*=\s*"([^"]+)"/m)?.[1];
        const en = body.match(/^\s*enabled\s*=\s*(true|false)/m)?.[1];
        if (p && en === 'false') disabledPaths.add(p);
      }
    }
    // One find call per dir resolves every symlink (nsenter is expensive —
    // a readlink per skill would add seconds inside the container).
    const links = new Map<string, string>();
    const lr = await hostExec(
      `find ${shq(root)} -mindepth 1 -maxdepth 1 -type l -printf '%f\\t%l\\n' 2>/dev/null`,
      { user: 'user', timeoutMs: 10_000 }
    );
    if (lr.ok) {
      for (const line of lr.stdout.split('\n')) {
        const [ln, lt] = line.split('\t');
        if (ln && lt) links.set(ln, lt.replace(/\/$/, ''));
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
      // Existence checks must resolve the symlink target as a HOST path — the
      // link is absolute and /hostfs can't traverse it inside the container.
      const lt = links.get(name);
      const linkTarget = lt ? (lt.startsWith('/') ? lt : `${root}/${lt}`) : undefined;
      const effBase = linkTarget || base;
      const hasOn = await hostExists(`${effBase}/SKILL.md`);
      const hasOff = await hostExists(`${effBase}/SKILL.md.off`);
      if (!hasOn && !hasOff) {
        // plugin-cached dir or other content — skip non-skill entries quietly
        continue;
      }
      const meta = parseSkillMeta((await readText(`${effBase}/SKILL.md`)) ?? (await readText(`${effBase}/SKILL.md.off`)) ?? '');
      const tomlDisabled = dir.toggle === 'codex-toml' && disabledPaths.has(`${base}/SKILL.md`);
      items.push({
        kind: 'skill', key: name, name: meta.name || name, desc: meta.desc,
        detail: linkTarget ? `→ ${linkTarget}` : base,
        file: `${effBase}/${hasOn ? 'SKILL.md' : 'SKILL.md.off'}`,
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

// Credentials hide in more than `env`/`headers`: url query strings, userinfo
// and flag args (--api-key x / KEY=v / -p x) all reach the browser otherwise.
const SECRET_ARG_RE = /key|token|secret|pass|credential|authorization|bearer|auth/i;
function scrubSecretText(v: string): string {
  // userinfo (any scheme — wss://token@h leaks the same way https:// does),
  // query params and #fragment key=values.
  return v.replace(/([a-zA-Z][a-zA-Z0-9+\-.]*:\/\/)[^\s/@]+@/g, '$1•••@').replace(/([?&#][^=&\s"']+=)[^&\s"']+/g, '$1•••');
}
function maskArg(v: unknown, prev?: unknown): string {
  const s = String(v);
  if (SECRET_ARG_RE.test(String(prev ?? '')) || SECRET_ARG_RE.test(s.split('=')[0])) return '•••';
  return scrubSecretText(s);
}
const maskArgs = (arr: unknown[]): string => arr.map((x, i) => maskArg(x, arr[i - 1])).join(' ');

function mcpTarget(s: Record<string, unknown>): string {
  const url = (s.url ?? s.serverUrl ?? s.httpUrl) as string | undefined;
  if (url) return scrubSecretText(url);
  const cmd = s.command as string | undefined;
  if (cmd) {
    // `command` may itself be a compound string carrying --flag SECRET pairs.
    const args = Array.isArray(s.args) ? maskArgs(s.args) : '';
    return maskArgs(`${cmd} ${args}`.trim().split(/\s+/)).slice(0, 80);
  }
  if (Array.isArray(s.command)) return maskArgs(s.command).slice(0, 80);
  return '';
}

function mcpUrl(s: Record<string, unknown>): string | undefined {
  const url = (s.url ?? s.serverUrl ?? s.httpUrl) as string | undefined;
  // Scrub credentials and query params — MCP URLs often carry ?key=… tokens.
  return url && /^https?:\/\//.test(url) ? scrubSecretText(url) : undefined;
}

// Raw config for the drawer — secret-looking values are masked at any depth,
// and URLs/args are scrubbed of credentials and query parameters.
function mcpRaw(s: Record<string, unknown>): Record<string, unknown> {
  const mask = (k: string, v: unknown): unknown => {
    if (SECRET_KEY_RE.test(k)) return v && typeof v === 'object' ? Object.keys(v as object) : '•••';
    // `headers` values are almost always the credential itself, often under a
    // name the key-regex can't guess (X-Custom-Auth…) — mask every leaf.
    if (/^headers?$/i.test(k) && v && typeof v === 'object' && !Array.isArray(v)) {
      const o: Record<string, unknown> = {};
      for (const [k2, x] of Object.entries(v as Record<string, unknown>)) {
        o[k2] = typeof x === 'string' || x == null ? '•••' : mask(k2, x);
      }
      return o;
    }
    if (Array.isArray(v)) return v.map((x, i) => (typeof x === 'string' ? maskArg(x, v[i - 1]) : mask('', x)));
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k2, x] of Object.entries(v as Record<string, unknown>)) o[k2] = mask(k2, x);
      return o;
    }
    if (k === 'command' && typeof v === 'string') return maskArgs(v.split(/\s+/).filter(Boolean));
    return typeof v === 'string' ? scrubSecretText(v) : v;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) out[k] = mask(k, v);
  return out;
}

// JSON MCP maps live under a per-agent key: mcpServers (claude/cursor/…),
// context_servers (zed), etc. Disabled entries park under _disabled<Key>.
function mcpKeys(m: NonNullable<AgentDef['mcp']>): { servers: string; parked: string } {
  const k = m.key || 'mcpServers';
  return { servers: k, parked: `_disabled${k[0].toUpperCase()}${k.slice(1)}` };
}

async function scanMcps(def: AgentDef): Promise<AgentItem[]> {
  const m = def.mcp;
  if (!m) return [];
  const items: AgentItem[] = [];
  if (m.format === 'toml') {
    const text = (await readText(m.paths()[0])) ?? '';
    const secs = tomlSections(text).filter(
      (s) => s.header.startsWith('mcp_servers.') && !tomlTableName(s.header.slice('mcp_servers.'.length)).isSub
    );
    for (const s of secs) {
      const name = tomlUnquote(s.header.slice('mcp_servers.'.length));
      const body = s.lines.slice(s.start + 1, s.end).join('\n');
      const enabled = body.match(/^\s*enabled\s*=\s*(true|false)/m)?.[1] !== 'false';
      const rawUrl = body.match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1];
      const rawCmd = body.match(/^\s*command\s*=\s*"([^"]+)"/m)?.[1];
      // A `command = "npx --api-key SECRET"` table leaks the flag pair the same
      // way a JSON args array does — scrub it with the same arg masking.
      const detail = rawUrl !== undefined
        ? scrubSecretText(rawUrl)
        : maskArgs((rawCmd ?? '').split(/\s+/).filter(Boolean));
      items.push({
        kind: 'mcp', key: name, name, detail, enabled, toggleable: true, deletable: true,
        url: rawUrl && /^https?:\/\//.test(rawUrl) ? scrubSecretText(rawUrl) : undefined, file: m.paths()[0],
      });
    }
    return items;
  }
  if (m.format === 'opencode') {
    // opencode merges opencode.jsonc + opencode.json — first file wins for
    // display state (paths[0] is the primary config).
    const merged = new Map<string, { s: Record<string, unknown>; file: string }>();
    for (const p of m.paths()) {
      const json = await readJsonFile(p);
      const mcp = (json?.mcp ?? {}) as Record<string, Record<string, unknown>>;
      for (const [name, s] of Object.entries(mcp)) if (!merged.has(name)) merged.set(name, { s, file: p });
    }
    for (const [name, { s, file }] of merged) {
      items.push({
        kind: 'mcp', key: name, name, detail: mcpTarget(s),
        enabled: s.enabled !== false, toggleable: true, deletable: true,
        url: mcpUrl(s), file, raw: mcpRaw(s),
      });
    }
    return items;
  }
  const p0 = m.paths()[0];
  const json = await readJsonFile(p0);
  if (!json) return items;
  const { servers: serversKey, parked: parkedKey } = mcpKeys(m);
  const servers = (json[serversKey] ?? {}) as Record<string, Record<string, unknown>>;
  const parked = (json[parkedKey] ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, s] of Object.entries(servers)) {
    const enabled = m.format === 'cursor' ? s.disabled !== true : true;
    items.push({ kind: 'mcp', key: name, name, detail: mcpTarget(s), enabled, toggleable: true, deletable: true, url: mcpUrl(s), file: p0, raw: mcpRaw(s) });
  }
  if (m.format === 'json-park' || m.format === 'serverurl') {
    for (const [name, s] of Object.entries(parked)) {
      items.push({ kind: 'mcp', key: name, name, detail: mcpTarget(s), enabled: false, toggleable: true, deletable: true, url: mcpUrl(s), file: p0, raw: mcpRaw(s) });
    }
  }
  return items;
}

async function scanPlugins(def: AgentDef): Promise<AgentItem[]> {
  const items: AgentItem[] = [];
  if (def.plugins === 'codex-toml') {
    const text = (await readText(def.mcp!.paths()[0])) ?? '';
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
    const listed = new Map<string, { enabled: boolean }>(); // basename → state (first wins)
    const cliEntries: { clean: string; enabled: boolean }[] = [];
    const cliSeen = new Set<string>();
    for (const entry of cli?.plugins ?? []) {
      const disabled = entry.startsWith('-');
      const p = disabled ? entry.slice(1) : entry;
      const base = p.split('/').pop() || p;
      if (!listed.has(base)) listed.set(base, { enabled: !disabled });
      // same-basename npm specs stay distinct via their full id as key
      if (!cliSeen.has(p)) { cliSeen.add(p); cliEntries.push({ clean: p, enabled: !disabled }); }
    }
    const seenKeys = new Set<string>();
    for (const f of await hostDirEntries(`${root}/plugins`)) {
      const m = f.match(/^(.+)\.ts(\.off)?$/);
      const dirOff = !m ? f.match(/^([^.]+)\.off$/) : null;
      const name = m ? m[1] : dirOff ? dirOff[1] : f.includes('.') ? null : f;
      if (!name || name === 'node_modules' || seenKeys.has(name)) continue;
      seenKeys.add(name);
      const cliState = listed.get(name);
      items.push({
        kind: 'plugin', key: name, name, scope: m ? 'archivo' : 'local',
        detail: `${root}/plugins/${f}`, file: `${root}/plugins/${f}`,
        enabled: cliState?.enabled ?? !f.endsWith('.off'),
        toggleable: true, deletable: true,
      });
    }
    for (const { clean, enabled } of cliEntries) {
      const base = clean.split('/').pop() || clean;
      if (seenKeys.has(base)) continue;
      seenKeys.add(base);
      items.push({ kind: 'plugin', key: clean, name: base, scope: 'cli', enabled, toggleable: true, deletable: true });
    }
    return items;
  }
  if (def.plugins === 'openchamber') {
    // managed config written by OpenChamber — '-' prefix disables a plugin
    const json = await readJsonFile(`${H()}/.config/openchamber/opencode.managed.json`);
    for (const entry of (json?.plugins ?? []) as string[]) {
      const disabled = entry.startsWith('-');
      const clean = disabled ? entry.slice(1) : entry;
      items.push({
        kind: 'plugin', key: clean.split('/').pop() || clean, name: clean.split('/').pop() || clean,
        scope: 'openchamber', detail: clean,
        enabled: !disabled, toggleable: true, deletable: true,
      });
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
    // fall through — a custom ANTHROPIC_BASE_URL env provider must show up
    // even when no OAuth account data exists in .claude.json
  }
  if (def.id === 'openchamber') {
    const gh = await readHostJson<{ user?: string; login?: string }>(`${H()}/.config/openchamber/github-auth.json`);
    if (gh) items.push({ kind: 'provider', key: 'github', name: 'GitHub', detail: gh.user || gh.login, enabled: true, toggleable: false, deletable: false });
    return items;
  }
  // generic: pull real provider definitions (opencode auth+config, zed
  // language_models, codex/kimi model_providers, pi models.json, claude env)
  const pds = await extractProviders(def);
  for (const p of pds) {
    items.push({
      kind: 'provider', key: p.key, name: p.name,
      detail: [
        p.api === 'oauth' ? 'oauth' : p.baseUrl || PROVIDER_ENDPOINTS[p.name]?.base || p.api,
        p.api !== 'oauth' && !p.hasKey ? (p.envRef ? `key: env ${p.envRef}` : 'sin key') : '',
      ].filter(Boolean).join(' · '),
      enabled: true, toggleable: false, deletable: false,
      hasKey: p.hasKey || !!p.envRef, copyable: true, file: p.source,
    });
  }
  return items;
}

// --- providers: normalized extract / copy between agents / health check ---
//
// Every agent stores providers differently, so we read a normalized
// descriptor (name/api/baseUrl/key/models) and write it back in each
// target's native format. Raw API keys never reach the browser — the copy
// happens entirely server-side and the check endpoint only returns status.

export interface ProviderDef {
  key: string;          // provider id within the agent ('openrouter'…)
  name: string;
  api: 'openai' | 'anthropic' | 'google' | 'oauth' | 'unknown';
  baseUrl?: string;
  apiKey?: string;      // raw secret — internal only
  envRef?: string;      // '{env:VAR}' reference in config
  hasKey: boolean;
  models?: string[];
  expiresAt?: number;   // oauth token expiry (ms) when known
  source?: string;      // file it was read from
}

// Default endpoints for well-known provider ids (models.dev naming).
const PROVIDER_ENDPOINTS: Record<string, { base: string; api: ProviderDef['api'] }> = {
  openai: { base: 'https://api.openai.com/v1', api: 'openai' },
  anthropic: { base: 'https://api.anthropic.com', api: 'anthropic' },
  google: { base: 'https://generativelanguage.googleapis.com', api: 'google' },
  gemini: { base: 'https://generativelanguage.googleapis.com', api: 'google' },
  openrouter: { base: 'https://openrouter.ai/api/v1', api: 'openai' },
  deepseek: { base: 'https://api.deepseek.com', api: 'openai' },
  mistral: { base: 'https://api.mistral.ai/v1', api: 'openai' },
  xai: { base: 'https://api.x.ai/v1', api: 'openai' },
  groq: { base: 'https://api.groq.com/openai/v1', api: 'openai' },
  together: { base: 'https://api.together.xyz/v1', api: 'openai' },
  fireworks: { base: 'https://api.fireworks.ai/inference/v1', api: 'openai' },
  cerebras: { base: 'https://api.cerebras.ai/v1', api: 'openai' },
  moonshot: { base: 'https://api.moonshot.ai/v1', api: 'openai' },
  kimi: { base: 'https://api.moonshot.ai/v1', api: 'openai' },
  'ollama-cloud': { base: 'https://ollama.com/v1', api: 'openai' },
  opencode: { base: 'https://opencode.ai/zen/v1', api: 'openai' },
  'opencode-go': { base: 'https://opencode.ai/zen/v1', api: 'openai' },
  'minimax-coding-plan': { base: 'https://api.minimax.io/v1', api: 'openai' },
  minimax: { base: 'https://api.minimax.io/v1', api: 'openai' },
  zai: { base: 'https://api.z.ai/api/paas/v4', api: 'openai' },
  'zai-coding-plan': { base: 'https://api.z.ai/api/coding/paas/v4', api: 'openai' },
  glm: { base: 'https://api.z.ai/api/paas/v4', api: 'openai' },
  bigmodel: { base: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai' },
  qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai' },
  dashscope: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai' },
  // local runtimes — probed keyless
  ollama: { base: 'http://localhost:11434/v1', api: 'openai' },
  lmstudio: { base: 'http://localhost:1234/v1', api: 'openai' },
};

const PROVIDER_WRITABLE = new Set([
  'opencode', 'openchamber', 'codex', 'kimi', 'zed', 'pi',
  'claude', 'commandcode', 'openclaude',
]);

export function agentTakesProviders(def: AgentDef): boolean {
  return PROVIDER_WRITABLE.has(def.id) || !!def.custom;
}

function guessApi(name: string, base?: string): ProviderDef['api'] {
  const s = `${name} ${base || ''}`.toLowerCase();
  if (/anthropic|claude|minimax/.test(s)) return 'anthropic';
  if (/gemini|googleapis|google/.test(s)) return 'google';
  return 'openai';
}

// opencode stores credentials in auth.json (api keys + oauth) and custom
// endpoints in the provider block of opencode.jsonc/json — merge both.
async function extractOpencodeProviders(root: string, dataDir: string): Promise<ProviderDef[]> {
  const auth = await readHostJson<Record<string, { type?: string; key?: string; access?: string; refresh?: string; expires?: number }>>(
    `${dataDir}/auth.json`);
  const acc = await readHostJson<{ accounts?: Record<string, { serviceID?: string; credential?: { type?: string } }> }>(
    `${dataDir}/account.json`);
  const out = new Map<string, ProviderDef>();
  for (const [name, a] of Object.entries(auth ?? {})) {
    const type = a?.type || 'api';
    out.set(name, {
      key: name, name,
      api: type === 'oauth' ? 'oauth' : guessApi(name),
      apiKey: a?.key || a?.access,
      hasKey: !!(a?.key || a?.access),
      expiresAt: a?.expires,
      source: `${dataDir}/auth.json`,
    });
  }
  for (const [id, a] of Object.entries(acc?.accounts ?? {})) {
    const name = a?.serviceID || id;
    if (!out.has(name)) out.set(name, {
      key: name, name, api: 'oauth', hasKey: a?.credential?.type === 'oauth', source: `${dataDir}/account.json`,
    });
  }
  for (const p of [`${root}/opencode.jsonc`, `${root}/opencode.json`]) {
    const json = await readJsonFile(p);
    const providers = (json?.provider ?? {}) as Record<string, { options?: { apiKey?: string; baseURL?: string }; models?: Record<string, unknown> }>;
    for (const [name, cfg] of Object.entries(providers)) {
      const rawKey = cfg?.options?.apiKey || '';
      const envRef = rawKey.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/)?.[1];
      const cur = out.get(name);
      const pd: ProviderDef = cur ?? { key: name, name, api: guessApi(name, cfg?.options?.baseURL), hasKey: false };
      if (cfg?.options?.baseURL) pd.baseUrl = cfg.options.baseURL;
      if (cfg?.models) pd.models = Object.keys(cfg.models);
      if (envRef) pd.envRef = envRef;
      else if (rawKey) { pd.apiKey = rawKey; pd.hasKey = true; }
      pd.source = pd.source ?? p;
      out.set(name, pd);
    }
  }
  return [...out.values()];
}

// zed settings.json: native ids live flat under language_models; custom
// OpenAI-compatible endpoints nest under language_models.openai_compatible.
function extractZedProviders(settings: Record<string, unknown> | null, source: string): ProviderDef[] {
  const lm = (settings?.language_models ?? {}) as Record<string, unknown>;
  const out: ProviderDef[] = [];
  for (const [name, v] of Object.entries(lm)) {
    if (name === 'openai_compatible' && v && typeof v === 'object') {
      for (const [id, cfg0] of Object.entries(v as Record<string, { api_url?: string; api_key?: string; available_models?: { name?: string }[] }>)) {
        out.push({ key: `openai_compatible:${id}`, name: id, api: 'openai', baseUrl: cfg0?.api_url, apiKey: cfg0?.api_key, hasKey: !!cfg0?.api_key, models: cfg0?.available_models?.map((m) => m.name || '').filter(Boolean), source });
      }
      continue;
    }
    const cfg = (v ?? {}) as { api_url?: string; api_key?: string };
    out.push({ key: name, name, api: guessApi(name, cfg.api_url), baseUrl: cfg.api_url, apiKey: cfg.api_key, hasKey: !!cfg.api_key, source });
  }
  return out;
}

// codex-family (codex, kimi): [model_providers.NAME] in config.toml — keys
// are never inline, only `env_key` pointing at a shell env var.
async function extractTomlProviders(tomlPath: string): Promise<ProviderDef[]> {
  const text = await readText(tomlPath);
  if (text == null) return [];
  const out: ProviderDef[] = [];
  for (const s of tomlSections(text)) {
    if (!s.header.startsWith('model_providers.')) continue;
    const name = tomlTableName(s.header.slice('model_providers.'.length)).name;
    const body = s.lines.slice(s.start, s.end).join('\n');
    const field = (k: string) => body.match(new RegExp(`^\\s*${k}\\s*=\\s*"?([^"\\n]+)"?`, 'm'))?.[1]?.trim();
    const base = field('base_url');
    out.push({
      key: name, name: field('name') || name,
      api: guessApi(name, base), baseUrl: base,
      envRef: field('env_key'), hasKey: false,
      source: tomlPath,
    });
  }
  return out;
}

export async function extractProviders(def: AgentDef): Promise<ProviderDef[]> {
  const id = def.id.replace(/^custom-/, '');
  const root = def.configRoot();
  if (id === 'opencode' || def.id === 'openchamber') {
    return extractOpencodeProviders(root, def.custom ? root : `${H()}/.local/share/opencode`);
  }
  if (id === 'zed') return extractZedProviders(await readJsonFile(`${root}/settings.json`), `${root}/settings.json`);
  if (id === 'codex' || id === 'kimi' || id === 'grok') {
    return extractTomlProviders(`${root}/config.toml`);
  }
  if (id === 'pi') {
    const p = def.custom ? `${root}/models.json` : `${root}/agent/models.json`;
    const arr = await readHostJson<{ name?: string; baseUrl?: string; apiKey?: string; api?: string; models?: { id?: string; name?: string }[] }[]>(p);
    return (Array.isArray(arr) ? arr : []).map((m, i) => ({
      key: m.name || `p${i}`, name: m.name || `provider ${i + 1}`,
      api: /anthropic/.test(m.api || '') ? 'anthropic' : /google/.test(m.api || '') ? 'google' : 'openai',
      baseUrl: m.baseUrl, apiKey: m.apiKey, hasKey: !!m.apiKey,
      models: m.models?.map((x) => x.id || x.name || '').filter(Boolean), source: p,
    }));
  }
  // claude-compatible CLIs accept a single anthropic-compatible provider
  // via env keys inside settings.json
  if (['claude', 'commandcode', 'openclaude'].includes(id)) {
    const settings = await readJsonFile(`${root}/settings.json`);
    const env = (settings?.env ?? {}) as Record<string, string>;
    if (!env.ANTHROPIC_BASE_URL && !env.ANTHROPIC_AUTH_TOKEN) return [];
    return [{
      key: 'custom-anthropic', name: env.ANTHROPIC_BASE_URL?.replace(/^https?:\/\//, '').split('/')[0] || 'custom',
      api: 'anthropic', baseUrl: env.ANTHROPIC_BASE_URL, apiKey: env.ANTHROPIC_AUTH_TOKEN,
      hasKey: !!env.ANTHROPIC_AUTH_TOKEN, source: `${root}/settings.json`,
    }];
  }
  return [];
}

// A config may reference a key as {env:VAR} — resolve from the user's
// shell rc files so copies carry the real secret.
async function resolveEnvVar(name: string): Promise<string | undefined> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return undefined;
  const r = await hostExec(
    `grep -hoE '^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=[[:space:]]*[^[:space:]]+' ` +
    `$HOME/.bashrc $HOME/.zshrc $HOME/.profile $HOME/.bash_profile $HOME/.zshenv $HOME/.env 2>/dev/null | head -1`,
    { user: 'user', timeoutMs: 10_000 }
  );
  const m = r.stdout.match(/=\s*['"]?([^\s'"]+)/);
  return m?.[1];
}

// --- writers ---

async function writeOpencodeProvider(root: string, dataDir: string, p: ProviderDef): Promise<{ ok: boolean; error?: string; note?: string }> {
  return withFileLocks([`${dataDir}/auth.json`, `${root}/opencode.jsonc`], async () => {
  if (p.apiKey) {
    const authPath = `${dataDir}/auth.json`;
    const auth = (await readJsonFile(authPath)) ?? {};
    auth[p.name] = { type: 'api', key: p.apiKey };
    const w = await writeJsonDoc(authPath, auth);
    if (!w.ok) return w;
  }
  const cfgPath = `${root}/opencode.jsonc`;
  const json = (await readJsonFile(cfgPath)) ?? {};
  const providers = (json.provider ?? {}) as Record<string, unknown>;
  const cur = (providers[p.name] ?? {}) as Record<string, unknown>;
  const opts = { ...((cur.options ?? {}) as Record<string, unknown>) };
  if (p.baseUrl) opts.baseURL = p.baseUrl;
  if (p.apiKey && !p.envRef) opts.apiKey = p.apiKey;
  const next: Record<string, unknown> = { ...cur, options: opts };
  // custom (non-models.dev) ids need an npm adapter package
  if (!PROVIDER_ENDPOINTS[p.name] && !cur.npm) {
    next.npm = p.api === 'anthropic' ? '@ai-sdk/anthropic' : p.api === 'google' ? '@ai-sdk/google' : '@ai-sdk/openai-compatible';
  }
  if (p.models?.length) next.models = Object.fromEntries(p.models.map((m) => [m, (cur.models as Record<string, unknown> | undefined)?.[m] ?? {}]));
  providers[p.name] = next;
  json.provider = providers;
  const w = await writeJsonDoc(cfgPath, json);
  return w.ok ? { ok: true, note: `guardado en auth.json + provider "${p.name}" en opencode.jsonc` } : w;
  });
}

// Claude-compatible CLIs only take ONE anthropic-compatible provider, via
// env keys in settings.json.
async function writeClaudeEnvProvider(root: string, p: ProviderDef): Promise<{ ok: boolean; error?: string; note?: string }> {
  if (p.api !== 'anthropic' && !/anthropic|claude|minimax/i.test(p.name)) {
    return { ok: false, error: 'Solo acepta providers compatibles con la API de Anthropic' };
  }
  const settingsPath = `${root}/settings.json`;
  return withFileLocks([settingsPath], async () => {
  const json = (await readJsonFile(settingsPath)) ?? {};
  const env = { ...((json.env ?? {}) as Record<string, string>) };
  if (p.baseUrl) env.ANTHROPIC_BASE_URL = p.baseUrl;
  if (p.apiKey) env.ANTHROPIC_AUTH_TOKEN = p.apiKey;
  json.env = env;
  const w = await writeJsonDoc(settingsPath, json);
  return w.ok ? { ok: true, note: 'ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN en settings.json' } : w;
  });
}

async function writeTomlProvider(tomlPath: string, p: ProviderDef): Promise<{ ok: boolean; error?: string; note?: string }> {
  if (!p.baseUrl) return { ok: false, error: 'Necesita base_url — este agente no define providers sin endpoint' };
  return withFileLocks([tomlPath], async () => {
  const text = (await readText(tomlPath)) ?? '';
  let out = tomlRemoveTable(text, 'model_providers', p.name) ?? text;
  const envKey = `${p.name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
  const wireApi = p.api === 'openai' && /openai/.test(p.name) ? 'responses' : 'chat';
  out = `${out.replace(/\s+$/, '')}\n\n[model_providers."${p.name}"]\nname = "${p.name}"\nbase_url = "${p.baseUrl}"\nenv_key = "${envKey}"\nwire_api = "${wireApi}"\n`;
  const w = await writeHostText(tomlPath, out);
  return w.ok
    ? { ok: true, note: `La key va en la env var ${envKey} — exportala en tu shell (ej: ~/.bashrc)` }
    : w;
  });
}

const ZED_NATIVE = new Set(['openai', 'anthropic', 'google', 'ollama', 'lmstudio', 'deepseek', 'mistral', 'openrouter', 'x_ai', 'copilot_chat', 'vercel']);

async function writeZedProvider(settingsPath: string, p: ProviderDef): Promise<{ ok: boolean; error?: string; note?: string }> {
  return withFileLocks([settingsPath], async () => {
  const json = (await readJsonFile(settingsPath)) ?? {};
  const lm = (json.language_models ?? {}) as Record<string, unknown>;
  const zedName = p.name.replace(/-/g, '_');
  if (ZED_NATIVE.has(zedName)) {
    const cur = ((lm[zedName] ?? {}) as Record<string, unknown>);
    lm[zedName] = { ...cur, ...(p.baseUrl ? { api_url: p.baseUrl } : {}), ...(p.apiKey ? { api_key: p.apiKey } : {}) };
  } else {
    const oc = (lm.openai_compatible ?? {}) as Record<string, unknown>;
    const cur = (oc[p.name] ?? {}) as Record<string, unknown>;
    oc[p.name] = {
      ...cur,
      api_url: p.baseUrl ?? cur.api_url,
      ...(p.apiKey ? { api_key: p.apiKey } : {}),
      ...(p.models?.length ? { available_models: p.models.map((m) => ({ name: m })) } : {}),
    };
    lm.openai_compatible = oc;
  }
  json.language_models = lm;
  const w = await writeJsonDoc(settingsPath, json);
  return w.ok
    ? { ok: true, note: 'en language_models — si Zed ignora api_key en settings, cargala una vez desde su UI' }
    : w;
  });
}

async function writePiProvider(modelsPath: string, p: ProviderDef): Promise<{ ok: boolean; error?: string; note?: string }> {
  return withFileLocks([modelsPath], async () => {
  const existing = await readHostJson<Record<string, unknown>[]>(modelsPath);
  const arr = Array.isArray(existing) ? existing : [];
  const entry = {
    name: p.name,
    baseUrl: p.baseUrl,
    api: p.api === 'anthropic' ? 'anthropic-messages' : p.api === 'google' ? 'google-generative-ai' : 'openai-completions',
    apiKey: p.apiKey,
    models: (p.models ?? []).map((m) => ({ id: m, name: m })),
  };
  const i = arr.findIndex((m) => m.name === p.name);
  if (i >= 0) arr[i] = { ...arr[i], ...entry };
  else arr.push(entry);
  const w = await writeJsonDoc(modelsPath, arr);
  return w.ok ? { ok: true, note: 'agregado a models.json' } : w;
  });
}

export async function copyProvider(srcId: string, key: string, targetId: string): Promise<{ ok: boolean; error?: string; note?: string }> {
  const src = agentById(srcId);
  const tgt = agentById(targetId);
  if (!src || !tgt) return { ok: false, error: 'Agente desconocido' };
  const p = (await extractProviders(src)).find((x) => x.key === key);
  if (!p) return { ok: false, error: `Provider "${key}" no encontrado en ${src.name}` };
  if (p.api === 'oauth') {
    return { ok: false, error: 'Es OAuth — el token es efímero y está atado a esta app. Autenticá de nuevo en el agente destino.' };
  }
  if (!p.apiKey && p.envRef) {
    p.apiKey = await resolveEnvVar(p.envRef);
    p.hasKey = !!p.apiKey;
  }
  // well-known provider id without explicit baseURL → its canonical endpoint
  if (!p.baseUrl && PROVIDER_ENDPOINTS[p.name]) p.baseUrl = PROVIDER_ENDPOINTS[p.name].base;
  const id = tgt.id.replace(/^custom-/, '');
  const root = tgt.configRoot();
  if (tgt.id === 'opencode' || tgt.id === 'openchamber' || id === 'opencode') {
    return writeOpencodeProvider(root, tgt.custom ? root : `${H()}/.local/share/opencode`, p);
  }
  if (['claude', 'commandcode', 'openclaude'].includes(id)) {
    return writeClaudeEnvProvider(root, p);
  }
  if (id === 'codex' || id === 'kimi') {
    if (p.api === 'anthropic' && !PROVIDER_ENDPOINTS[p.name]) {
      return { ok: false, error: 'Endpoints anthropic no hablan el wire format de codex (chat completions)' };
    }
    return writeTomlProvider(`${root}/config.toml`, p);
  }
  if (id === 'zed') {
    if (p.api === 'anthropic' && !ZED_NATIVE.has(p.name.replace(/-/g, '_'))) {
      return { ok: false, error: 'Zed no admite providers anthropic custom desde settings' };
    }
    return writeZedProvider(`${root}/settings.json`, p);
  }
  if (id === 'pi') return writePiProvider(tgt.custom ? `${root}/models.json` : `${root}/agent/models.json`, p);
  return { ok: false, error: `${tgt.name} no soporta providers por archivo (formato desconocido)` };
}

// --- health check ---

export interface ProviderCheck {
  state: 'ok' | 'bad' | 'warn' | 'unknown';
  msg: string;
  code?: number;
  ms?: number;
  at: number;
}

const provCheckCache = new Map<string, ProviderCheck>();

export function cachedProviderCheck(agentId: string, key: string): ProviderCheck | undefined {
  return provCheckCache.get(`${agentId}:${key}`);
}

export async function checkProvider(agentId: string, key: string): Promise<ProviderCheck> {
  const cacheKey = `${agentId}:${key}`;
  const def = agentById(agentId);
  const p = def ? (await extractProviders(def)).find((x) => x.key === key) : undefined;
  const done = (r: Omit<ProviderCheck, 'at'>) => {
    const res = { ...r, at: Date.now() };
    provCheckCache.delete(cacheKey); provCheckCache.set(cacheKey, res); // LRU-bump
    if (provCheckCache.size > 100) provCheckCache.delete(provCheckCache.keys().next().value!);
    return res;
  };
  if (!p) return done({ state: 'unknown', msg: 'provider no encontrado' });

  // oauth — no probing, but JWT/expires tell us if the session lapsed
  if (p.api === 'oauth') {
    if (p.expiresAt) {
      const left = p.expiresAt - Date.now();
      return left > 0
        ? done({ state: 'ok', msg: `oauth activo — expira ${new Date(p.expiresAt).toLocaleDateString('es')}` })
        : done({ state: 'bad', msg: `token vencido el ${new Date(p.expiresAt).toLocaleDateString('es')}` });
    }
    return done({ state: 'unknown', msg: 'oauth — sin fecha de expiración visible' });
  }

  const apiKey = p.apiKey || (p.envRef ? await resolveEnvVar(p.envRef) : undefined);

  const known = PROVIDER_ENDPOINTS[p.name];
  const base = (p.baseUrl || known?.base || '').replace(/\/+$/, '');
  const localOnly = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(base);
  if (!apiKey && !localOnly) return done({ state: 'warn', msg: `sin key accesible${p.envRef ? ` (${p.envRef} no está en el shell)` : ''}` });
  // the endpoint table is authoritative for api style when it covers the id
  const api = known?.api ?? (p.api === 'unknown' ? guessApi(p.name, base) : p.api);
  if (!base) return done({ state: 'unknown', msg: 'sin endpoint conocido — chequeo manual' });

  // openai-style bases already end in /v1; anthropic-style don't
  const url = api === 'google' ? `${base}/v1beta/models?key=${apiKey}`
    : api === 'anthropic' ? `${base}/v1/models`
    : `${base}/models`;
  // for anthropic-style bases that already end in /anthropic, still /v1/models
  const headers: Record<string, string> =
    api === 'anthropic'
      ? { 'x-api-key': apiKey ?? '', 'anthropic-version': '2023-06-01' }
      : api === 'google'
        ? {}
        : apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - t0;
    if (r.ok) return done({ state: 'ok', msg: `HTTP ${r.status}`, code: r.status, ms });
    if (r.status === 401 || r.status === 403) return done({ state: 'bad', msg: 'key inválida o vencida', code: r.status, ms });
    if (r.status === 402) return done({ state: 'bad', msg: 'sin saldo / billing', code: r.status, ms });
    if (r.status === 429) return done({ state: 'ok', msg: 'key válida (rate limited)', code: r.status, ms });
    if (r.status === 404) return done({ state: 'warn', msg: `endpoint existe, /models no (HTTP 404)`, code: r.status, ms });
    return done({ state: 'warn', msg: `HTTP ${r.status}`, code: r.status, ms });
  } catch (e) {
    return done({ state: 'bad', msg: e instanceof Error && e.name === 'TimeoutError' ? 'timeout (8s)' : 'sin respuesta', ms: Date.now() - t0 });
  }
}

// --- public API ---

// detectPrograms() is the expensive part (~30 hostExec + npm view calls).
// programs.ts owns a shared stale-while-revalidate cache (getPrograms) used by
// both /api/programs and this rail.
async function detectProgramsCached() {
  return getPrograms();
}

const detailCache = new SnapshotCache<AgentDetail | null>(10_000);
const discoveryCache = new SnapshotCache<Awaited<ReturnType<typeof discoverAgents>>>(60_000, 1);
const searchCache = new SnapshotCache<{ agent: string; agentName: string; kind: string; key: string; name: string; enabled: boolean }[]>(8_000, 25);
let listGeneration = 0;
let listCache: { at: number; data: AgentSummary[] } | null = null;
let listInflight: Promise<AgentSummary[]> | null = null;
const LIST_TTL = 30_000;
const LIST_STALE = 5 * 60_000;
export function invalidateAgentsCache(): void {
  listGeneration++;
  listCache = null;
  listInflight = null;
  detailCache.clear();
  discoveryCache.clear();
  searchCache.clear();
}

// A GUI app with no CLI bin still counts as installed when it ships a
// .desktop entry (Cursor, Claude Desktop, Zed…). Checks the standard
// applications dirs on the host.
async function hasDesktopEntry(def: AgentDef): Promise<boolean> {
  if (!def.desktopNames?.length) return false;
  const perName = def.desktopNames
    .map((n) => `for d in /usr/share/applications /usr/local/share/applications "$HOME/.local/share/applications" /var/lib/flatpak/exports/share/applications /var/lib/snapd/desktop/applications; do [ -f "$d/${n}.desktop" ] && exit 0; done`)
    .join('; ');
  return (await hostExec(`${perName}; exit 1`, { user: 'user', timeoutMs: 10_000 })).ok;
}

export async function listAgents(): Promise<AgentSummary[]> {
  if (listCache) {
    const age = Date.now() - listCache.at;
    if (age < LIST_TTL) return listCache.data;
    // Stale but usable: return it now, recompute for the next caller.
    if (age < LIST_STALE) {
      refreshAgentList().catch(() => {});
      return listCache.data;
    }
  }
  return refreshAgentList();
}

async function refreshAgentList(): Promise<AgentSummary[]> {
  if (!listInflight) {
    const generation = listGeneration;
    const flight = computeAgentList()
      .then((data) => {
        if (generation === listGeneration) listCache = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        if (listInflight === flight) listInflight = null;
      });
    listInflight = flight;
  }
  return listInflight;
}

async function computeAgentList(): Promise<AgentSummary[]> {
  // Run the per-agent fs scans concurrently with the programs detection —
  // neither depends on the other (versions/auth use the static registry).
  const progP = Promise.resolve(peekPrograms());
  const scannedP = Promise.all(
    allDefs().map(async (def) => {
      const hasBin = def.bin ? (await hostExec(`command -v ${def.bin}`, { user: 'user', timeoutMs: 10_000 })).ok : false;
      const hasDesktop = hasBin ? false : await hasDesktopEntry(def);
      const hasConfig = await hostExists(def.configRoot());
      const installed = def.shared ? hasConfig : hasBin || hasDesktop || hasConfig;
      const residual = !def.shared && installed && !hasBin && !hasDesktop;
      const progDef = def.programId ? programById(def.programId) : undefined;
      const [skills, mcps, plugins, auth, hasSettings] = installed
        ? await Promise.all([
            scanSkills(def), scanMcps(def), scanPlugins(def), agentAuth(def),
            def.configFile ? hostExists(def.configFile()) : Promise.resolve(false),
          ])
        : [[], [], [], undefined, false];
      let version: string | undefined;
      version = peekPrograms().find(p => p.id === def.programId)?.version;
      return { def, installed, residual, version, auth, hasSettings, counts: { skills: skills.length, mcps: mcps.length, plugins: plugins.length } };
    })
  );
  const [progs, scanned] = await Promise.all([progP, scannedP]);
  const progViews = new Map(progs.map((p) => [p.id, p]));

  return scanned.map((s) => {
    const prog = s.def.programId ? progViews.get(s.def.programId) : undefined;
    return {
      id: s.def.id, name: s.def.name, icon: s.def.icon, brandIcon: s.def.brandIcon,
      iconKey: s.def.bin || s.def.id,
      programId: s.def.programId, installed: s.installed, residual: s.residual || undefined,
      custom: s.def.custom || undefined, provWritable: agentTakesProviders(s.def) || undefined,
      version: prog?.version ?? s.version,
      latestVersion: prog?.latestVersion,
      auth: prog?.auth ?? s.auth,
      counts: s.counts,
      configRoot: s.def.configRoot(),
      hasConfig: s.hasSettings,
    };
  });
}

export function agentDetail(id: string): Promise<AgentDetail | null> {
  return detailCache.get(id, () => computeAgentDetail(id));
}
async function computeAgentDetail(id: string): Promise<AgentDetail | null> {
  const def = agentById(id);
  if (!def) return null;
  const hasBin = def.bin ? (await hostExec(`command -v ${def.bin}`, { user: 'user', timeoutMs: 10_000 })).ok : false;
  const hasDesktop = hasBin ? false : await hasDesktopEntry(def);
  const hasConfig = await hostExists(def.configRoot());
  const installed = def.shared ? hasConfig : hasBin || hasDesktop || hasConfig;
  const residual = !def.shared && installed && !hasBin && !hasDesktop;
  const prog = def.programId ? programById(def.programId) : undefined;
  const [skills, mcps, plugins, providers, hasSettings] = await Promise.all([
    scanSkills(def), scanMcps(def), scanPlugins(def), scanProviders(def),
    def.configFile ? hostExists(def.configFile()) : Promise.resolve(false),
  ]);
  let version: string | undefined;
  version = peekPrograms().find(p => p.id === def.programId)?.version;
  const notes: string[] = [...(def.notes ?? [])];
  if (residual) notes.push('Solo quedó la carpeta de configuración — no hay binario ni .desktop: probablemente fue desinstalado. Podés gestionar los restos o ignorarlo.');
  if (def.shared) notes.push('Estas skills las ven todos los agentes — desactivar o borrar acá afecta a todos.');
  if (def.mcp && (def.mcp.format === 'json-park' || def.mcp.format === 'serverurl')) {
    const { servers, parked } = mcpKeys(def.mcp);
    notes.push(`Este agente no tiene flag nativo para MCPs: al desactivar, la entrada se mueve de "${servers}" a "${parked}" (reversible, no se pierde la config).`);
  }
  return {
    id: def.id, name: def.name, icon: def.icon, brandIcon: def.brandIcon,
    programId: def.programId, installed, residual: residual || undefined, version, custom: def.custom || undefined,
    auth: installed ? await agentAuth(def) : undefined,
    counts: { skills: skills.length, mcps: mcps.length, plugins: plugins.length },
    configRoot: def.configRoot(),
    hasConfig: hasSettings,
    items: [...providers, ...skills, ...mcps, ...plugins],
    notes,
  };
}

// --- mutations ---

const NAME_OK = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

async function toggleMcp(def: AgentDef, key: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const m = def.mcp!;
  return withFileLocks(m.paths(), async () => {
  if (m.format === 'toml') {
    const p = m.paths()[0];
    const text = await readText(p);
    if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
    const out = tomlSetEnabled(text, 'mcp_servers', key, enabled);
    if (out == null) return { ok: false, error: `MCP "${key}" no encontrado` };
    return writeHostText(p, out);
  }
  if (m.format === 'opencode') {
    // a key may be defined in both config files — flip it everywhere it
    // appears so the merged view stays consistent.
    let found = false;
    for (const p of m.paths()) {
      const json = await readJsonFile(p);
      const mcp = (json?.mcp ?? {}) as Record<string, Record<string, unknown>>;
      if (!Object.hasOwn(mcp, key) || !mcp[key] || typeof mcp[key] !== 'object') continue;
      if (mcp[key].enabled === enabled) { found = true; continue; } // already in target state
      mcp[key].enabled = enabled;
      json!.mcp = mcp;
      const w = await writeJsonDoc(p, json);
      if (!w.ok) return w;
      found = true;
    }
    return found ? { ok: true } : { ok: false, error: `MCP "${key}" no encontrado` };
  }
  const p = m.paths()[0];
  const json = await readJsonFile(p);
  if (!json) return { ok: false, error: `No se pudo leer ${p}` };
  if (m.format === 'cursor') {
    const servers = (json.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
    if (!Object.hasOwn(servers, key) || !servers[key] || typeof servers[key] !== 'object') return { ok: false, error: `MCP "${key}" no encontrado` };
    if ((servers[key].disabled === true) === !enabled) return { ok: true };
    servers[key].disabled = !enabled;
    json.mcpServers = servers;
    return writeJsonDoc(p, json);
  }
  // json-park / serverurl: move entry between <key> ⇄ _disabled<Key>
  const { servers: serversKey, parked: parkedKey } = mcpKeys(m);
  const servers = (json[serversKey] ?? {}) as Record<string, Record<string, unknown>>;
  const parked = (json[parkedKey] ?? {}) as Record<string, Record<string, unknown>>;
  const from = enabled ? parked : servers;
  const to = enabled ? servers : parked;
  if (!Object.hasOwn(from, key)) return Object.hasOwn(to, key) ? { ok: true } : { ok: false, error: `MCP "${key}" no encontrado` };
  to[key] = from[key];
  delete from[key];
  json[serversKey] = servers;
  if (Object.keys(parked).length) json[parkedKey] = parked;
  else delete json[parkedKey];
  return writeJsonDoc(p, json);
  });
}

// Entries in a plugins[] list are disabled by a '-' prefix and may be npm
// specs (org/name) — match the exact entry first so same-basename specs
// don't toggle each other.
function pluginListIndex(list: string[], key: string): number | 'ambiguous' | -1 {
  const clean = (e: string) => (e.startsWith('-') ? e.slice(1) : e);
  const exact = list.findIndex((e) => clean(e) === key);
  if (exact >= 0) return exact;
  const hits = list.map((e, i) => (clean(e).split('/').pop() === key ? i : -1)).filter((i) => i >= 0);
  return hits.length > 1 ? 'ambiguous' : hits[0] ?? -1;
}

function setPluginListEntry(list: string[], idx: number, enabled: boolean): boolean {
  const cur = list[idx];
  const next = enabled ? cur.replace(/^-/, '') : (cur.startsWith('-') ? cur : `-${cur}`);
  if (next === cur) return false; // already in target state — no-op
  list[idx] = next;
  return true;
}

async function togglePlugin(def: AgentDef, key: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  if (def.plugins === 'codex-toml') {
    const path = def.mcp!.paths()[0];
    return withFileLocks([path], async () => {
      const text = await readText(path);
      if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
      const out = tomlSetEnabled(text, 'plugins', key, enabled);
      if (out == null) return { ok: false, error: `Plugin "${key}" no encontrado` };
      return writeHostText(path, out);
    });
  }
  if (def.plugins === 'claude') {
    const path = `${H()}/.claude/settings.json`;
    return withFileLocks([path], async () => {
      const json = (await readHostJson<Record<string, unknown>>(path)) ?? {};
      const ep = (json.enabledPlugins ?? {}) as Record<string, boolean>;
      if (!Object.hasOwn(ep, key)) return { ok: false, error: `Plugin "${key}" no encontrado` };
      if (ep[key] === enabled) return { ok: true };
      ep[key] = enabled;
      json.enabledPlugins = ep;
      return writeJsonDoc(path, json);
    });
  }
  if (def.plugins === 'opencode') {
    const root = `${H()}/.config/opencode`;
    const cliPath = `${root}/cli.json`;
    const pfx = `${root}/plugins/${key}`;
    return withFileLocks([cliPath, pfx], async () => {
    // file/dir-based plugin: plugins/<name>.ts ⇄ .ts.off ; dir ⇄ dir.off
    // The resolved parent must stay under the agent's own config root — for
    // '/' keys (@org/name) the intermediate dir, for plain keys the plugins
    // dir itself; either could be a planted symlink out of the tree.
    if (!(await pathWithinRoot(def.configRoot(), pfx.slice(0, pfx.lastIndexOf('/'))))) {
      return { ok: false, error: 'La carpeta de plugins es un symlink fuera del árbol del agente' };
    }
    const candidates = [`${pfx}.ts`, pfx];
    for (const on of candidates) {
      const off = `${on}.off`;
      const hasOn = await hostExists(on);
      const hasOff = await hostExists(off);
      if (!hasOn && !hasOff) continue;
      if (enabled === hasOn) return { ok: true }; // already in target state
      const from = enabled ? off : on;
      const to = enabled ? on : off;
      // refuse to rename through a symlink (same guard as toggleSkill)
      const l = await hostExec(`[ -L ${shq(from)} ] || [ -L ${shq(to)} ]`, { user: 'user', timeoutMs: 10_000 });
      if (l.ok) return { ok: false, error: 'El plugin es un symlink — no se renombra' };
      const r = await hostExec(`mv ${shq(from)} ${shq(to)}`, { user: 'user', timeoutMs: 10_000 });
      return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(0, 300) };
    }
    // cli.json plugins array: '-' prefix disables
    const cli = await readHostJson<{ plugins?: string[] }>(cliPath);
    if (!cli?.plugins) return { ok: false, error: `Plugin "${key}" no encontrado` };
    const idx = pluginListIndex(cli.plugins, key);
    if (idx === 'ambiguous') return { ok: false, error: `Hay varios plugins con ese nombre — usá el id completo` };
    if (idx < 0) return { ok: false, error: `Plugin "${key}" no encontrado` };
    if (!setPluginListEntry(cli.plugins, idx, enabled)) return { ok: true };
    return writeJsonDoc(cliPath, cli);
    });
  }
  if (def.plugins === 'openchamber') {
    const p = `${H()}/.config/openchamber/opencode.managed.json`;
    return withFileLocks([p], async () => {
      const json = (await readJsonFile(p)) ?? {};
      const plugins = (json.plugins ?? []) as string[];
      const idx = pluginListIndex(plugins, key);
      if (idx === 'ambiguous') return { ok: false, error: `Hay varios plugins con ese nombre — usá el id completo` };
      if (idx < 0) return { ok: false, error: `Plugin "${key}" no encontrado` };
      if (!setPluginListEntry(plugins, idx, enabled)) return { ok: true };
      json.plugins = plugins;
      return writeJsonDoc(p, json);
    });
  }
  if (def.plugins === 'antigravity') {
    const path = `${H()}/.gemini/config/config.json`;
    return withFileLocks([path], async () => {
      const json = (await readHostJson<Record<string, unknown>>(path)) ?? {};
      const plugins = (json.plugins ?? {}) as Record<string, { enabled?: boolean }>;
      if (!Object.hasOwn(plugins, key) || !plugins[key] || typeof plugins[key] !== 'object') return { ok: false, error: `Plugin "${key}" no encontrado` };
      if (plugins[key].enabled === enabled) return { ok: true };
      plugins[key].enabled = enabled;
      json.plugins = plugins;
      return writeJsonDoc(path, json);
    });
  }
  return { ok: false, error: 'Este agente no soporta gestión de plugins' };
}

// A skills dir that is itself a symlink (or nested under one) resolves outside
// this agent's config root — rename/delete would then operate on files the
// agent tree doesn't own. Refuse to act through it.
async function skillsDirWithinRoot(def: AgentDef, dirPath: string): Promise<boolean> {
  const r = await hostExec(
    `d=$(realpath -m ${shq(dirPath)}) && c=$(realpath -m ${shq(def.configRoot())}/) && case "$d/" in "$c"*) exit 0;; *) exit 1;; esac`,
    { user: 'user', timeoutMs: 10_000 });
  return r.ok;
}

// Same symlink guard for a resolved path against an expected parent root —
// covers npm-style keys ('@org/name') where an intermediate component could
// be a planted symlink out of the plugins dir.
async function pathWithinRoot(rootDir: string, target: string): Promise<boolean> {
  const r = await hostExec(
    `d=$(realpath -m ${shq(rootDir)}/) && t=$(realpath -m ${shq(target)}) && case "$t/" in "$d"*) exit 0;; *) exit 1;; esac`,
    { user: 'user', timeoutMs: 10_000 });
  return r.ok;
}

async function toggleSkill(def: AgentDef, key: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const dir = def.skillsDirs?.[0];
  if (!dir) return { ok: false, error: 'Sin carpeta de skills' };
  if (!okKey(key) || key.includes('/')) return { ok: false, error: 'Skill inválida' };
  const base = `${dir.path()}/${key}`;
  if (dir.toggle === 'codex-toml') {
    const path = def.mcp!.paths()[0];
    return withFileLocks([path], async () => {
      const text = await readText(path);
      if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
      const out = tomlSkillConfigSet(text, `${base}/SKILL.md`, enabled);
      return writeHostText(path, out);
    });
  }
  return withFileLocks([base], async () => {
    if (!(await skillsDirWithinRoot(def, dir.path()))) {
      return { ok: false, error: 'La carpeta de skills es un symlink fuera del árbol del agente' };
    }
    const on = `${base}/SKILL.md`;
    const off = `${base}/SKILL.md.off`;
    const from = enabled ? off : on;
    const to = enabled ? on : off;
    if (!(await hostExists(from))) {
      if (await hostExists(to)) return { ok: true }; // already in target state
      return { ok: false, error: `Skill "${key}" no encontrada` };
    }
    // never rename through a symlink — a linked skill dir lives outside this
    // agent's tree and mv would move a file inside the *target* directory.
    const l = await hostExec(
      `[ -L ${shq(base)} ] || [ -L ${shq(from)} ] || [ -L ${shq(to)} ]`,
      { user: 'user', timeoutMs: 10_000 },
    );
    if (l.ok) return { ok: false, error: 'La skill es un symlink — no se renombra' };
    const r = await hostExec(`mv ${shq(from)} ${shq(to)}`, { user: 'user', timeoutMs: 10_000 });
    return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(0, 300) };
  });
}

async function deleteItem(def: AgentDef, kind: string, key: string): Promise<{ ok: boolean; error?: string }> {
  if (kind === 'skill') {
    const dir = def.skillsDirs?.[0];
    if (!dir || !okKey(key) || key.includes('/')) return { ok: false, error: 'Skill inválida' };
    const base = `${dir.path()}/${key}`;
    const tomlPath = dir.toggle === 'codex-toml' ? def.mcp!.paths()[0] : base;
    return withFileLocks([base, tomlPath], async () => {
      if (!(await skillsDirWithinRoot(def, dir.path()))) {
        return { ok: false, error: 'La carpeta de skills es un symlink fuera del árbol del agente' };
      }
      // A linked skill (skills CLI symlink) is deleted by removing only the
      // link — rm never follows it, but unlinking keeps the target intact.
      const l = await hostExec(`[ -L ${shq(base)} ]`, { user: 'user', timeoutMs: 10_000 });
      const r = l.ok
        ? await hostExec(`rm -f ${shq(base)}`, { user: 'user', timeoutMs: 10_000 })
        : await hostExec(`rm -rf -- ${shq(base)}`, { user: 'user', timeoutMs: 15_000 });
      if (!r.ok) return { ok: false, error: r.stderr.slice(0, 300) };
      // clean a stale codex [[skills.config]] entry if present
      if (dir.toggle === 'codex-toml') {
        const path = def.mcp!.paths()[0];
        const text = await readText(path);
        if (text != null) await writeHostText(path, tomlSkillConfigRemove(text, `${base}/SKILL.md`));
      }
      return { ok: true };
    });
  }
  if (kind === 'mcp') {
    const m = def.mcp!;
    return withFileLocks(m.paths(), async () => {
    if (m.format === 'toml') {
      const p = m.paths()[0];
      const text = await readText(p);
      if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
      const out = tomlRemoveTable(text, 'mcp_servers', key);
      if (out == null) return { ok: false, error: `MCP "${key}" no encontrado` };
      return writeHostText(p, out);
    }
    if (m.format === 'opencode') {
      let found = false;
      for (const p of m.paths()) {
        const json = await readJsonFile(p);
        const mcp = (json?.mcp ?? {}) as Record<string, unknown>;
        if (!Object.hasOwn(mcp, key)) continue;
        delete mcp[key];
        json!.mcp = mcp;
        const w = await writeJsonDoc(p, json);
        if (!w.ok) return w;
        found = true;
      }
      return found ? { ok: true } : { ok: false, error: `MCP "${key}" no encontrado` };
    }
    const p = m.paths()[0];
    const json = await readJsonFile(p);
    if (!json) return { ok: false, error: `No se pudo leer ${p}` };
    const { servers: serversKey, parked: parkedKey } = mcpKeys(m);
    const servers = (json[serversKey] ?? {}) as Record<string, unknown>;
    const parked = (json[parkedKey] ?? {}) as Record<string, unknown>;
    if (!Object.hasOwn(servers, key) && !Object.hasOwn(parked, key)) return { ok: false, error: `MCP "${key}" no encontrado` };
    delete servers[key];
    delete parked[key];
    json[serversKey] = servers;
    if (Object.keys(parked).length) json[parkedKey] = parked;
    else delete json[parkedKey];
    return writeJsonDoc(p, json);
    });
  }
  if (kind === 'plugin') {
    if (def.plugins === 'codex-toml') {
      const path = def.mcp!.paths()[0];
      return withFileLocks([path], async () => {
        const text = await readText(path);
        if (text == null) return { ok: false, error: 'No se pudo leer config.toml' };
        const out = tomlRemoveTable(text, 'plugins', key);
        if (out == null) return { ok: false, error: `Plugin "${key}" no encontrado` };
        return writeHostText(path, out);
      });
    }
    if (def.plugins === 'claude') {
      const sPath = `${H()}/.claude/settings.json`;
      const iPath = `${H()}/.claude/plugins/installed_plugins.json`;
      return withFileLocks([sPath, iPath], async () => {
        const settings = (await readHostJson<Record<string, unknown>>(sPath)) ?? {};
        const ep = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
        delete ep[key];
        settings.enabledPlugins = ep;
        const w1 = await writeJsonDoc(sPath, settings);
        if (!w1.ok) return w1;
        const inst = await readHostJson<{ plugins?: Record<string, unknown> }>(iPath);
        if (inst?.plugins && Object.hasOwn(inst.plugins, key)) {
          delete inst.plugins[key];
          await writeJsonDoc(iPath, inst);
        }
        return { ok: true };
      });
    }
    if (def.plugins === 'opencode') {
      const root = `${H()}/.config/opencode`;
      const cliPath = `${root}/cli.json`;
      return withFileLocks([cliPath, `${root}/plugins/${key}`], async () => {
        const rmTargets = [`${root}/plugins/${key}`, `${root}/plugins/${key}.off`, `${root}/plugins/${key}.ts`, `${root}/plugins/${key}.ts.off`];
        // The resolved parent must stay under the agent's config root — '/' keys
        // traverse an intermediate dir; for plain keys that IS plugins/, which
        // could itself be a planted symlink out of the tree.
        if (!(await pathWithinRoot(def.configRoot(), `${root}/plugins/${key}`.split('/').slice(0, -1).join('/')))) {
          return { ok: false, error: 'La carpeta de plugins es un symlink fuera del árbol del agente' };
        }
        // symlinked entries are unlinked, never followed
        const l = await hostExec(`for f in ${rmTargets.map(shq).join(' ')}; do [ -L "$f" ] && echo link; done`, { user: 'user', timeoutMs: 10_000 });
        const r = l.stdout.includes('link')
          ? await hostExec(`for f in ${rmTargets.map(shq).join(' ')}; do [ -L "$f" ] && rm -f "$f" || rm -rf "$f"; done 2>/dev/null`, { user: 'user', timeoutMs: 15_000 })
          : await hostExec(`rm -rf ${rmTargets.map(shq).join(' ')} 2>/dev/null`, { user: 'user', timeoutMs: 15_000 });
        const cli = await readHostJson<{ plugins?: string[] }>(cliPath);
        if (cli?.plugins) {
          const idx = pluginListIndex(cli.plugins, key);
          if (typeof idx === 'number') {
            cli.plugins.splice(idx, 1);
            await writeJsonDoc(cliPath, cli);
          }
        }
        return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(0, 300) };
      });
    }
    if (def.plugins === 'openchamber') {
      const p = `${H()}/.config/openchamber/opencode.managed.json`;
      return withFileLocks([p], async () => {
        const json = await readJsonFile(p);
        const plugins = (json?.plugins ?? []) as string[];
        const idx = pluginListIndex(plugins, key);
        if (typeof idx !== 'number') return { ok: false, error: `Plugin "${key}" no encontrado` };
        plugins.splice(idx, 1);
        json!.plugins = plugins;
        return writeJsonDoc(p, json);
      });
    }
    if (def.plugins === 'antigravity') {
      const path = `${H()}/.gemini/config/config.json`;
      return withFileLocks([path], async () => {
        const json = (await readHostJson<Record<string, unknown>>(path)) ?? {};
        const plugins = (json.plugins ?? {}) as Record<string, unknown>;
        if (!Object.hasOwn(plugins, key)) return { ok: false, error: `Plugin "${key}" no encontrado` };
        delete plugins[key];
        json.plugins = plugins;
        return writeJsonDoc(path, json);
      });
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
  return withFileLocks([base], async () => {
    if (!(await skillsDirWithinRoot(def, dir.path()))) {
      return { ok: false, error: 'La carpeta de skills es un symlink fuera del árbol del agente' };
    }
    const r = await hostExec(`mkdir -p ${shq(base)}`, { user: 'user', timeoutMs: 10_000 });
    if (!r.ok) return { ok: false, error: r.stderr.slice(0, 300) };
    return writeHostText(`${base}/SKILL.md`, md);
  });
}

async function addMcp(def: AgentDef, name: string, url: string, command: string, args: string): Promise<{ ok: boolean; error?: string }> {
  const m = def.mcp;
  if (!m) return { ok: false, error: 'Este agente no tiene config de MCPs gestionable' };
  if (!okKey(name)) return { ok: false, error: 'Nombre inválido' };
  if (!url && !command) return { ok: false, error: 'Indicá una URL (remoto) o un comando (stdio)' };
  if (url && !/^https?:\/\//.test(url)) return { ok: false, error: 'La URL debe empezar con http(s)://' };

  return withFileLocks(m.paths(), async () => {
  if (m.format === 'toml') {
    const p = m.paths()[0];
    const text = (await readText(p)) ?? '';
    const exists = findTomlTable(tomlSections(text), 'mcp_servers', name).length > 0;
    if (exists) return { ok: false, error: 'Ya existe un MCP con ese nombre' };
    const block = url
      ? `\n[mcp_servers.${JSON.stringify(name)}]\nurl = ${JSON.stringify(url)}\n`
      : `\n[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(command)}\n${args ? `args = [${args.split(/\s+/).map((a) => JSON.stringify(a)).join(', ')}]\n` : ''}`;
    return writeHostText(p, text.replace(/\s+$/, '') + '\n' + block);
  }

  if (m.format === 'opencode') {
    // check every file for a name clash, then write to the primary (jsonc)
    for (const p of m.paths()) {
      const json = await readJsonFile(p);
      if (json?.mcp && (json.mcp as Record<string, unknown>)[name]) {
        return { ok: false, error: 'Ya existe un MCP con ese nombre' };
      }
    }
    const p = m.paths()[0];
    const json = (await readJsonFile(p)) ?? {};
    const mcp = (json.mcp ?? {}) as Record<string, unknown>;
    mcp[name] = url
      ? { type: 'remote', url, enabled: true }
      : { type: 'local', command: [command, ...(args ? args.split(/\s+/) : [])], enabled: true };
    json.mcp = mcp;
    return writeJsonDoc(p, json);
  }

  const p = m.paths()[0];
  const json = (await readJsonFile(p)) ?? {};
  const entry: Record<string, unknown> = url
    ? (m.format === 'serverurl' ? { serverUrl: url } : { url })
    : { command, ...(args ? { args: args.split(/\s+/) } : {}) };
  const serversKey = m.key || 'mcpServers';
  const servers = (json[serversKey] ?? {}) as Record<string, unknown>;
  if (servers[name]) return { ok: false, error: 'Ya existe un MCP con ese nombre' };
  servers[name] = entry;
  json[serversKey] = servers;
  return writeJsonDoc(p, json);
  });
}

// --- visual settings (scalar top-level keys of each agent's config file) ---

interface SettingEntry {
  key: string;
  type: 'bool' | 'number' | 'string' | 'secret' | 'complex';
  value?: unknown;
  label?: string;
  desc?: string;
  options?: string[]; // enum choices → dropdown
}

const SECRET_KEY_RE = /key|token|secret|pass|credential|authorization|bearer/i;

function jsonSettingEntries(json: Record<string, unknown>): SettingEntry[] {
  return Object.entries(json).map(([key, v]) => {
    if (v !== null && typeof v === 'object') return { key, type: 'complex' };
    if (SECRET_KEY_RE.test(key)) return { key, type: 'secret' };
    if (typeof v === 'boolean') return { key, type: 'bool', value: v };
    if (typeof v === 'number') return { key, type: 'number', value: v };
    return { key, type: 'string', value: v == null ? '' : String(v) };
  });
}

// Top-level scalars of a TOML file (everything before the first [section]).
function tomlTopScalars(text: string): SettingEntry[] {
  const out: SettingEntry[] = [];
  for (const line of text.split('\n')) {
    if (/^\s*\[/.test(line)) break;
    const m = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*(?:#.*)?$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (SECRET_KEY_RE.test(key)) { out.push({ key, type: 'secret' }); continue; }
    if (raw === 'true' || raw === 'false') out.push({ key, type: 'bool', value: raw === 'true' });
    else if (/^-?\d+$/.test(raw)) out.push({ key, type: 'number', value: parseInt(raw, 10) });
    else if (/^-?\d+\.\d+$/.test(raw)) out.push({ key, type: 'number', value: parseFloat(raw) });
    else if (raw.startsWith('"') || raw.startsWith("'")) out.push({ key, type: 'string', value: tomlUnquote(raw) });
    else out.push({ key, type: 'complex' }); // arrays / inline tables
  }
  return out;
}

function tomlScalarLiteral(value: unknown): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  return JSON.stringify(String(value ?? ''));
}

function tomlSetScalar(text: string, key: string, value: unknown): string {
  const lit = tomlScalarLiteral(value);
  const lines = text.split('\n');
  const firstSec = lines.findIndex((l) => /^\s*\[/.test(l));
  const topEnd = firstSec < 0 ? lines.length : firstSec;
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  for (let i = 0; i < topEnd; i++) {
    if (re.test(lines[i])) { lines[i] = `${key} = ${lit}`; return lines.join('\n'); }
  }
  lines.splice(topEnd, 0, `${key} = ${lit}`);
  return lines.join('\n');
}

// Keys managed by dedicated tabs — the visual editor refuses to touch them
// (they'd clobber nested structures anyway). Covers every per-agent
// structured section: MCP pools, plugins, skills, providers, models…
const MANAGED_KEYS = new Set([
  'mcp', 'mcpServers', '_disabledMcpServers', 'mcp_servers', 'context_servers', 'servers',
  'plugins', 'enabledPlugins', 'skills', 'marketplaces', 'hooks',
  'provider', 'providers', 'model_providers', 'language_models', 'model_list',
  'env', 'permissions', 'accounts', 'auth',
]);

async function getSettings(def: AgentDef): Promise<{ file: string; format: 'toml' | 'json'; entries: SettingEntry[] } | null> {
  if (!def.configFile) return null;
  const file = def.configFile();
  const text = await readText(file);
  if (text == null) return null;
  if (file.endsWith('.toml')) {
    const entries = tomlTopScalars(text);
    const enums = KNOWN_ENUMS[def.id] ?? {};
    for (const e of entries) {
      if (enums[e.key]) e.options = enums[e.key];
      const meta = SETTING_LABELS[e.key];
      if (meta) { e.label = meta.label; e.desc = meta.desc; }
    }
    return { file, format: 'toml', entries };
  }
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(stripJsonComments(text)); } catch { return null; }
  if (!json) return null;
  const entries = jsonSettingEntries(json);
  // expose nested secret leaves (provider.minimax.apiKey…) — the vault
  const have = new Set(entries.map((e) => e.key));
  const nested: SettingEntry[] = [];
  flattenSecrets(json, '', 0, nested);
  for (const e of nested) if (!have.has(e.key)) entries.push(e);

  // dropdown options — first the file's own $schema (self-updating), then
  // known public schemas, then the curated enum map
  const declared = typeof json.$schema === 'string' && /^https?:\/\//.test(json.$schema)
    ? json.$schema : undefined;
  const schema = await fetchJsonSchema(declared ?? SCHEMA_URLS[def.id] ?? '');
  if (schema) {
    const props = schemaProps(schema);
    for (const e of entries) {
      if (e.key.includes('.')) continue;
      const meta = schemaPropMeta(schema, props[e.key]);
      if (meta.options?.length) e.options = meta.options;
      if (meta.desc && !e.desc) e.desc = meta.desc.slice(0, 180);
      if (meta.title && !e.label) e.label = meta.title;
    }
  }
  const enums = KNOWN_ENUMS[def.id] ?? {};
  for (const e of entries) if (!e.options && enums[e.key]) e.options = enums[e.key];

  for (const e of entries) {
    const meta = SETTING_LABELS[e.key] ?? SETTING_LABELS[e.key.split('.').pop()!];
    if (meta) { e.label = meta.label; e.desc = meta.desc ?? e.desc; }
  }
  return { file, format: 'json', entries };
}

async function setSetting(def: AgentDef, key: string, value: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!def.configFile || !okKey(key)) return { ok: false, error: 'Key inválida' };
  const topKey = key.split('.')[0];
  if (MANAGED_KEYS.has(topKey)) {
    // nested leaves of managed sections are the vault's job, not this editor —
    // but never let a bare key overwrite a whole managed section
    if (!key.includes('.')) return { ok: false, error: `La key "${key}" se gestiona en su propia pestaña` };
  }
  if (value !== null && typeof value === 'object') return { ok: false, error: 'Solo valores escalares' };
  const file = def.configFile();
  return withFileLocks([file], async () => {
  if (file.endsWith('.toml')) {
    // the key is interpolated into a regex and into TOML output — bare-key
    // syntax only, no quoting/escaping games
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(key)) return { ok: false, error: 'Key inválida para TOML' };
    const text = await readText(file);
    if (text == null) return { ok: false, error: 'No se pudo leer el archivo de config' };
    // a scalar write must not shadow an existing [table] — TOML would then
    // carry both "key = v" and "[key]", which is invalid/ambiguous. Dotted
    // keys also clash with tables at any prefix ([a] blocks a.b).
    const prefixes = key.split('.').map((_, i, a) => a.slice(0, i + 1).join('.'));
    if (tomlSections(text).some((s) => {
      const h = s.header;
      return prefixes.some((p) => h === p || tomlUnquote(h) === p) || h.startsWith(`${key}.`);
    })) {
      return { ok: false, error: `"${key}" es una sección — no se puede pisar con un escalar` };
    }
    return writeHostText(file, tomlSetScalar(text, key, value));
  }
  const json = (await readJsonFile(file)) ?? {};
  if (key.includes('.')) {
    // nested path — vault writes (provider.X.options.apiKey)
    const parts = key.split('.');
    if (parts.some((s) => !s || s === '__proto__' || s === 'constructor' || s === 'prototype')) {
      return { ok: false, error: 'Ruta de clave inválida' };
    }
    let node = json as Record<string, unknown>;
    for (const p of parts.slice(0, -1)) {
      if (!Object.prototype.hasOwnProperty.call(node, p)) {
        return { ok: false, error: `No existe el objeto "${p}" en la ruta` };
      }
      const next = node[p];
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        return { ok: false, error: `No existe el objeto "${p}" en la ruta` };
      }
      node = next as Record<string, unknown>;
    }
    node[parts[parts.length - 1]] = value;
  } else {
    // never flatten an existing object/array section into a scalar, even when
    // the section isn't on the managed list
    const cur = json[key];
    if (cur !== null && typeof cur === 'object') {
      return { ok: false, error: `"${key}" es una sección gestionada — no se puede pisar con un escalar` };
    }
    json[key] = value === '' ? '' : value;
  }
  return writeJsonDoc(file, json);
  });
}

// --- agent instruction docs (AGENTS.md, CLAUDE.md, rules…) ---
// One batched stat/find pass discovers global files plus per-project docs.

export interface AgentDoc {
  name: string;
  path: string;
  scope: 'global' | 'proyecto' | 'cursor-rules';
  agent: string;
  project?: string;
  size: number;
  mtime: number;
}

const GLOBAL_DOCS: [string, string][] = [
  ['.codex/AGENTS.md', 'Codex'],
  ['.claude/CLAUDE.md', 'Claude'],
  ['.claude/AGENTS.md', 'Claude'],
  ['.config/opencode/AGENTS.md', 'OpenCode'],
  ['.gemini/GEMINI.md', 'Gemini'],
  ['.gemini/AGENTS.md', 'Gemini'],
  ['.config/devin/AGENTS.md', 'Devin'],
  ['.codeium/windsurf/memories/global_rules.md', 'Windsurf'],
  ['.agents/AGENTS.md', 'global'],
  ['AGENTS.md', 'global'],
];

const PROJECT_DOC_NAMES = [
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CONVENTIONS.md',
  '.cursorrules', '.windsurfrules', 'copilot-instructions.md',
];

function docAgentLabel(name: string): string {
  if (name === 'CLAUDE.md') return 'Claude';
  if (name === 'GEMINI.md') return 'Gemini';
  if (name === '.cursorrules' || name.endsWith('.mdc')) return 'Cursor';
  if (name === '.windsurfrules') return 'Windsurf';
  if (name === 'copilot-instructions.md') return 'Copilot';
  return 'multi';
}

export interface AgentDocsResult {
  docs: AgentDoc[];
  missing: { name: string; dir: string }[];
}

let docsCache: { at: number; data: AgentDocsResult } | null = null;

export async function listAgentDocs(): Promise<AgentDocsResult> {
  if (docsCache && Date.now() - docsCache.at < 60_000) return docsCache.data;
  const docs: AgentDoc[] = [];
  const seen = new Set<string>();

  // 1) global files — one stat call (stat -c does not interpret \t → use |)
  const globalPaths = GLOBAL_DOCS.map(([rel]) => `${H()}/${rel}`);
  const st = await hostExec(
    `stat -c '%n|%s|%Y' ${globalPaths.map(shq).join(' ')} 2>/dev/null`,
    { user: 'user', timeoutMs: 15_000 }
  );
  const labels = new Map(GLOBAL_DOCS.map(([rel, l]) => [`${H()}/${rel}`, l]));
  for (const line of st.stdout.split('\n')) {
    const [p, size, mt] = line.split('|');
    if (!p || seen.has(p)) continue;
    seen.add(p);
    docs.push({
      name: p.split('/').pop()!, path: p, scope: 'global',
      agent: labels.get(p) || 'global',
      size: parseInt(size, 10) || 0, mtime: (parseFloat(mt) || 0) * 1000,
    });
  }

  // 2) cursor user rules dir (~/.cursor/rules/*.mdc + *.md)
  const rulesFind = await hostExec(
    `find ${shq(`${H()}/.cursor/rules`)} -maxdepth 1 -type f \\( -name '*.mdc' -o -name '*.md' \\) -printf '%p\\t%s\\t%T@\\n' 2>/dev/null`,
    { user: 'user', timeoutMs: 10_000 }
  );
  for (const line of rulesFind.stdout.split('\n')) {
    const [p, size, mt] = line.split('\t');
    if (!p || seen.has(p)) continue;
    seen.add(p);
    docs.push({
      name: p.split('/').pop()!, path: p, scope: 'cursor-rules', agent: 'Cursor',
      size: parseInt(size, 10) || 0, mtime: (parseFloat(mt) || 0) * 1000,
    });
  }

  // 3) project docs — registered project dirs + common scan roots.
  // isProjectDir=true → project label is the dir basename; for umbrella
  // roots (~/Proyectos) the label is the first path segment underneath.
  const roots = new Map<string, boolean>(); // path → isProjectDir
  roots.set(`${H()}/Proyectos`, false);
  roots.set(`${H()}/Projects`, false);
  for(const p of await projectSearchRoots(getProjectScanDirs()))roots.set(p,false);
  for (const p of getProjects()) if (p?.cwd) roots.set(p.cwd, true);
  const rootList: string[] = [];
  for (const r of roots.keys()) try{await resolveHostPath(r,{directory:true});rootList.push(r);}catch{/* disconnected mount */}
  if (rootList.length) {
    const nameExpr = PROJECT_DOC_NAMES.map((n) => `-name '${n}'`).join(' -o ');
    const r = await hostExec(
      `find ${rootList.map(shq).join(' ')} -maxdepth 6 -type f \\( ${nameExpr} -o -path '*/.cursor/rules/*.mdc' \\) -not -path '*/node_modules/*' -printf '%p\\t%s\\t%T@\\n' 2>/dev/null`,
      { user: 'user', timeoutMs: 30_000 }
    );
    const sortedRoots = [...roots.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const line of r.stdout.split('\n')) {
      const [p, size, mt] = line.split('\t');
      if (!p || seen.has(p)) continue;
      seen.add(p);
      const hit = sortedRoots.find(([rt]) => p.startsWith(rt + '/'));
      // Umbrella roots like ~/Proyectos/<grupo>/<proyecto>: a "01-" group
      // folder means the real project name is the second path segment.
      const segs = hit ? p.slice(hit[0].length + 1).split('/') : [];
      const project = hit
        ? (hit[1] ? hit[0].split('/').pop()
                  : (/^\d{2}-/.test(segs[0]) && segs.length > 1 ? segs[1] : segs[0]))
        : undefined;
      docs.push({
        name: p.split('/').pop()!, path: p, scope: 'proyecto',
        agent: docAgentLabel(p.split('/').pop()!),
        project,
        size: parseInt(size, 10) || 0, mtime: (parseFloat(mt) || 0) * 1000,
      });
    }
  }

  docs.sort((a, b) => (a.scope === b.scope ? (a.project || '').localeCompare(b.project || '') || a.path.localeCompare(b.path) : a.scope === 'global' ? -1 : 1));

  // 4) project dirs WITHOUT any agent doc — offers "Crear AGENTS.md"
  const missing = await missingAgentDocs(rootList, roots);

  const data = { docs, missing };
  docsCache = { at: Date.now(), data };
  return data;
}

// Registered + detected project dirs (package.json/.git markers) that lack a
// top-level AGENTS.md/CLAUDE.md — drives the "crear doc" suggestion.
async function missingAgentDocs(rootList: string[], roots: Map<string, boolean>): Promise<{ name: string; dir: string }[]> {
  const markerFind = await hostExec(
    `find ${rootList.filter((r) => !roots.get(r)).map(shq).join(' ') || '/nonexistent'} -mindepth 2 -maxdepth 4 \\( -name package.json -o -name .git \\) -not -path '*/node_modules/*' -printf '%h\\n' 2>/dev/null | sort -u`,
    { user: 'user', timeoutMs: 30_000 }
  );
  const dirs = new Set<string>([
    ...[...roots.entries()].filter(([, isProject]) => isProject).map(([p]) => p),
    ...markerFind.stdout.split('\n').filter(Boolean),
  ]);
  if (!dirs.size) return [];
  const check = await hostExec(
    `for d in ${[...dirs].map(shq).join(' ')}; do
       [ -f "$d/AGENTS.md" ] || [ -f "$d/CLAUDE.md" ] || [ -f "$d/GEMINI.md" ] || echo "$d"
     done`,
    { user: 'user', timeoutMs: 20_000 }
  );
  return check.stdout.split('\n').filter(Boolean)
    .filter((dir) => !dir.split('/').pop()!.startsWith('.')) // .next/.opencode etc are not projects
    .map((dir) => ({ name: dir.split('/').pop()!, dir }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const AGENTS_MD_TEMPLATE = (name: string) => `# ${name}

## Contexto

## Comandos

- Dev:
- Build:
- Tests:

## Convenciones

`;

export async function createAgentDoc(dir: string): Promise<{ ok: boolean; error?: string; path?: string }> {
  try{dir=await resolveHostPath(dir,{directory:true});}catch(e){return {ok:false,error:e instanceof Error?e.message:'Carpeta no disponible'};}
  if(dir.split('/').includes('node_modules'))return {ok:false,error:'Elegí la carpeta del proyecto'};
  if (!(await hostExists(dir))) return { ok: false, error: 'El directorio no existe' };
  const path = `${dir.replace(/\/$/, '')}/AGENTS.md`;
  if (await hostExists(path)) return { ok: false, error: 'Ya existe un AGENTS.md' };
  const content=Buffer.from(AGENTS_MD_TEMPLATE(dir.split('/').pop() || 'Proyecto')).toString('base64');
  const script='import os,sys,base64; fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644); f=os.fdopen(fd,"wb"); f.write(base64.b64decode(sys.argv[2])); f.close()';
  const result=await hostExec(`${shq(process.env.AXON_AGENT_PYTHON || 'python3')} -c ${shq(script)} ${shq(path)} ${shq(content)}`,{user:'user',timeoutMs:10_000});
  const r={ok:result.ok,error:'No se pudo crear el documento. Verificá permisos y que no exista.'};
  if (r.ok) docsCache = null;
  return r.ok ? { ok: true, path } : { ok: false, error: r.error };
}

// --- remote MCP health check ---

// scanMcps scrubs url/detail for the browser (••• in userinfo, every query
// value) — a health check must curl the REAL configured endpoint, so the raw
// URL is re-derived server-side and never leaves this process.
async function mcpEndpointRaw(def: AgentDef, key: string): Promise<string | undefined> {
  const m = def.mcp;
  if (!m) return undefined;
  const pick = (s: Record<string, unknown> | undefined) =>
    (s?.url ?? s?.serverUrl ?? s?.httpUrl) as string | undefined;
  if (m.format === 'toml') {
    const text = (await readText(m.paths()[0])) ?? '';
    // Same key derivation as scanMcps — a bare `[mcp_servers.a.b]` subtable
    // must not be confused with the quoted server `[mcp_servers."a.b"]`.
    const sec = tomlSections(text).find((s) => {
      if (!s.header.startsWith('mcp_servers.')) return false;
      const rest = s.header.slice('mcp_servers.'.length);
      return !tomlTableName(rest).isSub && tomlUnquote(rest) === key;
    });
    if (!sec) return undefined;
    return sec.lines.slice(sec.start + 1, sec.end).join('\n').match(/^\s*url\s*=\s*"([^"]+)"/m)?.[1];
  }
  if (m.format === 'opencode') {
    for (const p of m.paths()) {
      const json = await readJsonFile(p);
      const s = (json?.mcp as Record<string, unknown> | undefined)?.[key];
      if (s && typeof s === 'object') return pick(s as Record<string, unknown>);
    }
    return undefined;
  }
  const json = await readJsonFile(m.paths()[0]);
  if (!json) return undefined;
  const { servers: serversKey, parked: parkedKey } = mcpKeys(m);
  const s = ((json[serversKey] ?? {}) as Record<string, Record<string, unknown>>)[key]
    ?? ((json[parkedKey] ?? {}) as Record<string, Record<string, unknown>>)[key];
  return pick(s);
}

async function mcpHealth(def: AgentDef, key: string): Promise<{ ok: boolean; error?: string; url?: string; code?: number; ms?: number; alive?: boolean }> {
  const items = await scanMcps(def);
  const it = items.find((i) => i.key === key);
  if (!it) return { ok: false, error: `MCP "${key}" no encontrado` };
  if (!it.url) return { ok: false, error: 'MCP local (stdio) — no hay URL para chequear' };
  const raw = await mcpEndpointRaw(def, key);
  if (!raw || !/^https?:\/\//.test(raw)) return { ok: false, error: 'No se pudo leer la URL configurada del MCP' };
  const r = await hostExec(`curl -sS -o /dev/null -m 6 -w '%{http_code} %{time_total}' ${shq(raw)} 2>/dev/null`, { user: 'user', timeoutMs: 12_000 });
  const [codeS, timeS] = r.stdout.trim().split(/\s+/);
  const code = parseInt(codeS, 10) || 0;
  const ms = Math.round((parseFloat(timeS) || 0) * 1000);
  // any HTTP status means the endpoint is reachable; 000 = connection failed
  return { ok: true, url: it.url, code, ms, alive: r.ok && code > 0 };
}

// --- MCP × agent matrix ---

export async function mcpMatrix(): Promise<{ agents: { id: string; name: string; icon: string; brandIcon?: string }[]; rows: { name: string; detail?: string; cells: Record<string, 'on' | 'off'> }[] }> {
  const defs = allDefs().filter((d) => d.mcp && !d.shared);
  const scans = await Promise.all(
    defs.map(async (def) => {
      const hasBin = def.bin ? (await hostExec(`command -v ${def.bin}`, { user: 'user', timeoutMs: 10_000 })).ok : false;
      const hasConfig = await hostExists(def.configRoot());
      return hasBin || hasConfig ? { def, items: await scanMcps(def) } : null;
    })
  );
  const present = scans.filter((s): s is NonNullable<typeof s> => !!s && s.items.length > 0);
  const byName = new Map<string, { detail?: string; cells: Record<string, 'on' | 'off'> }>();
  for (const { def, items } of present) {
    for (const it of items) {
      const row = byName.get(it.key) ?? { cells: {} };
      row.cells[def.id] = it.enabled ? 'on' : 'off';
      row.detail ||= it.detail;
      byName.set(it.key, row);
    }
  }
  const rows = [...byName.entries()]
    .map(([name, r]) => ({ name, detail: r.detail, cells: r.cells }))
    .sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length || a.name.localeCompare(b.name));
  return {
    agents: present.map(({ def }) => ({ id: def.id, name: def.name, icon: def.icon, brandIcon: def.brandIcon })),
    rows,
  };
}

// --- .axonbak backups per agent ---

function agentManagedFiles(def: AgentDef): string[] {
  const files = new Set<string>();
  for (const p of def.mcp?.paths() ?? []) files.add(p);
  if (def.configFile) files.add(def.configFile());
  if (def.id === 'claude') { files.add(`${H()}/.claude/settings.json`); files.add(`${H()}/.claude.json`); }
  if (def.id === 'opencode') { files.add(`${H()}/.config/opencode/cli.json`); files.add(`${H()}/.config/opencode/opencode.json`); }
  if (def.id === 'openchamber') { files.add(`${H()}/.config/openchamber/opencode.managed.json`); }
  return [...files];
}

async function agentBackups(def: AgentDef): Promise<{ path: string; source: string; size: number; mtime: number }[]> {
  const candidates = agentManagedFiles(def).map((f) => `${f}.axonbak`);
  if (!candidates.length) return [];
  const r = await hostExec(`stat -c '%n|%s|%Y' ${candidates.map(shq).join(' ')} 2>/dev/null`, { user: 'user', timeoutMs: 15_000 });
  return r.stdout.split('\n').filter(Boolean).map((line) => {
    const [p, size, mt] = line.split('|');
    return { path: p, source: p.replace(/\.axonbak$/, ''), size: parseInt(size, 10) || 0, mtime: (parseFloat(mt) || 0) * 1000 };
  }).filter((b) => b.path);
}

async function restoreBackup(def: AgentDef, bakPath: string): Promise<{ ok: boolean; error?: string }> {
  const allowed = new Set(agentManagedFiles(def).map((f) => `${f}.axonbak`));
  if (!allowed.has(bakPath)) return { ok: false, error: 'Backup fuera de los archivos gestionados' };
  const src = bakPath.replace(/\.axonbak$/, '');
  return withFileLocks([src], async () => {
    // Copy to a temp sibling then rename — a failed/interrupted cp must not
    // leave the live config truncated.
    const tmp = `${src}.axonbak-tmp-${process.pid}-${Date.now().toString(36)}`;
    const r = await hostExec(`cp ${shq(bakPath)} ${shq(tmp)} && mv -fT ${shq(tmp)} ${shq(src)}; rc=$?; rm -f ${shq(tmp)}; exit $rc`, { user: 'user', timeoutMs: 15_000 });
    return r.ok ? { ok: true } : { ok: false, error: r.stderr.slice(0, 300) };
  });
}

// --- friendly labels for known setting keys ---

const SETTING_LABELS: Record<string, { label: string; desc?: string }> = {
  model: { label: 'Modelo por defecto', desc: 'Modelo que usa el agente si no elegís otro' },
  small_model: { label: 'Modelo liviano', desc: 'Para tareas rápidas/baratas (títulos, resúmenes)' },
  autoupdate: { label: 'Actualización automática', desc: 'El agente se actualiza solo al arrancar' },
  theme: { label: 'Tema' },
  sandbox_mode: { label: 'Modo sandbox', desc: 'workspace-write permite escribir solo dentro del proyecto' },
  approval_policy: { label: 'Política de aprobación', desc: 'Cuándo el agente pide confirmación para ejecutar' },
  model_reasoning_effort: { label: 'Esfuerzo de razonamiento', desc: 'low / medium / high — más esfuerzo, más costo' },
  service_tier: { label: 'Tier de servicio' },
  approvals_reviewer: { label: 'Revisor de aprobaciones' },
  mcp_oauth_callback_port: { label: 'Puerto callback OAuth MCP' },
  includeCoAuthoredBy: { label: 'Co-autor en commits', desc: 'Agrega el agente como co-author en git' },
  cleanupPeriodDays: { label: 'Días de retención', desc: 'Cuánto conserva historial/proyectos locales' },
  permissions: { label: 'Permisos', desc: 'Reglas allow/deny del agente' },
  env: { label: 'Variables de entorno' },
  defaultMode: { label: 'Modo por defecto' },
  share: { label: 'Compartir sesiones' },
  username: { label: 'Usuario' },
  provider: { label: 'Providers', desc: 'Configuración de proveedores de modelos' },
  plugins: { label: 'Plugins' },
  mcp: { label: 'MCP servers', desc: 'Se gestionan en la pestaña MCPs' },
  '$schema': { label: 'Schema JSON' },
};

// --- schema-driven setting options (dropdowns that update themselves) ---
// JSON configs can declare `"$schema": "<url>"` — we fetch it and pull enum /
// description / title per key, so the visual editor learns new settings and
// values as the agent ships schema updates. Agents without a published schema
// fall back to a curated enum map.

const SCHEMA_URLS: Record<string, string> = {
  claude: 'https://json.schemastore.org/claude-code-settings.json',
};

const KNOWN_ENUMS: Record<string, Record<string, string[]>> = {
  codex: {
    sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
    approval_policy: ['untrusted', 'on-failure', 'on-request', 'never'],
    model_reasoning_effort: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    service_tier: ['auto', 'default', 'fast', 'flex'],
    web_search: ['disabled', 'cached', 'live'],
    personality: ['none', 'friendly', 'pragmatic'],
  },
};

const schemaCache = new Map<string, { at: number; data: Record<string, unknown> | null }>();

async function fetchJsonSchema(url: string): Promise<Record<string, unknown> | null> {
  if (!url) return null;
  const hit = schemaCache.get(url);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.data;
  const r = await hostExec(`curl -fsSL --max-time 12 ${shq(url)} 2>/dev/null`, { user: 'user', timeoutMs: 18_000 });
  let data: Record<string, unknown> | null = null;
  try { if (r.ok && r.stdout) data = JSON.parse(r.stdout); } catch { /* bad schema json */ }
  // Unbounded growth: config-declared $schema URLs are attacker-controlled.
  if (schemaCache.size >= 64) {
    const oldest = schemaCache.keys().next().value;
    if (oldest !== undefined) schemaCache.delete(oldest);
  }
  schemaCache.set(url, { at: Date.now(), data });
  return data;
}

type JsonObj = Record<string, unknown>;

function schemaResolve(schema: JsonObj, node: unknown, depth: number): JsonObj {
  if (depth > 5 || !node || typeof node !== 'object') return {};
  const o = node as JsonObj;
  if (typeof o.$ref === 'string' && o.$ref.startsWith('#/')) {
    // full JSON-pointer path — def names can contain dots (ConfigV2.Ref.Git)
    let cur: unknown = schema;
    for (const seg of o.$ref.slice(2).split('/')) {
      if (!cur || typeof cur !== 'object') return {};
      cur = (cur as JsonObj)[seg];
    }
    return schemaResolve(schema, cur, depth + 1);
  }
  return o;
}

// enum/const choices + metadata for one property node
function schemaPropMeta(schema: JsonObj, prop: unknown): { options?: string[]; desc?: string; title?: string } {
  const out = { options: [] as string[], desc: undefined as string | undefined, title: undefined as string | undefined };
  const seen = new Set<string>();
  let hasBoolBranch = false;
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || !node || typeof node !== 'object') return;
    const o = schemaResolve(schema, node, depth);
    if (typeof o.description === 'string' && !out.desc) out.desc = o.description;
    if (typeof o.title === 'string' && !out.title) out.title = o.title;
    if (Array.isArray(o.enum)) {
      for (const v of o.enum) {
        const s = String(v);
        if (!seen.has(s)) { seen.add(s); out.options.push(s); }
      }
    }
    if (o.type === 'boolean') hasBoolBranch = true;
    for (const k of ['oneOf', 'anyOf', 'allOf'] as const) {
      for (const sub of (o[k] as unknown[] | undefined) ?? []) walk(sub, depth + 1);
    }
  };
  walk(prop, 0);
  if (hasBoolBranch) for (const s of ['true', 'false']) if (!seen.has(s)) out.options.push(s);
  if (out.options.length) out.options = out.options.filter((x) => x !== 'null');
  return out;
}

function schemaProps(schema: JsonObj | null): JsonObj {
  if (!schema) return {};
  const root = schemaResolve(schema, schema, 0);
  return (root.properties ?? {}) as JsonObj;
}

// flatten nested objects to expose secret leaves (provider.x.apiKey) — vault
function flattenSecrets(obj: Record<string, unknown>, prefix: string, depth: number, out: SettingEntry[]): void {
  if (depth > 4) return;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenSecrets(v as Record<string, unknown>, key, depth + 1, out);
    } else if (SECRET_KEY_RE.test(k)) {
      out.push({ key, type: 'secret' });
    }
  }
}

// --- routes ---

// Bounded JSON body — readBody() streams with a 300 KB cap regardless of the
// Content-Length header; failures degrade to {} so routes keep their existing
// "missing field" 400 behavior.
async function reqJson<T extends Record<string, unknown>>(c: Context): Promise<T> {
  try { return (await readBody(c)) as T; } catch { return {} as T; }
}

export function registerAgentRoutes(app: Hono): void {
  registerAgentContext(app,H,()=>allDefs().flatMap(d=>{const label=(d.id+' '+d.name).toLowerCase(),agent=['codex','claude','gemini'].find(a=>label.includes(a));return agent?[{agent,root:d.configRoot()}]:[];}));
  registerAgentArchives(app, {
    home:H, agents:()=>allDefs().map(def=>({id:def.id,name:def.name,root:def.configRoot(),shared:def.shared})),
    installed:async id=>{const def=agentById(id)!;return !!def.bin && (await hostExec(`command -v ${def.bin}`,{user:'user',timeoutMs:5000})).ok || await hasDesktopEntry(def);},
    changed:invalidateAgentsCache,
  });
  const changes: Record<string, string> = { settings: 'Configuración editada', toggle: 'Integración actualizada', delete: 'Integración eliminada', 'add-skill': 'Skill agregada', 'add-mcp': 'MCP agregado', 'restore-backup': 'Respaldo restaurado' };
  app.use('/api/agents/*', async (c, next) => {
    await next();
    const match = c.req.path.match(/^\/api\/agents\/([^/]+)\/([^/]+)$/);
    // only real mutations drop the cache — read-only POST probes (mcp-health,
    // provider check) must not invalidate every cached agent snapshot
    if (c.req.method !== 'POST' || !match || !changes[match[2]]) return;
    if (c.res.status < 300) invalidateAgentsCache();
    if (c.res.status >= 300) return;
    const def = agentById(match[1]);
    if (def) recordEvent('agent', `${def.name}: ${changes[match[2]]}`, undefined,
      { section: 'agents', params: { id: def.id, tab: ['settings','restore-backup'].includes(match[2]) ? 'config' : match[2]==='add-mcp' ? 'mcp' : 'skill' } });
  });
  app.get('/api/agents/activity', async (c) => {
    const candidates = AGENTS.flatMap(def => agentManagedFiles(def).map(source => ({def, source})));
    const backups = await Promise.all(candidates.map(async ({def, source}) => {
      const s = await stat(hostToContainer(source + '.axonbak')).catch(() => null);
      return s ? { agentId: def.id, agentName: def.name, source, mtime: s.mtimeMs } : null;
    }));
    return c.json({ ok: true, backups: backups.filter(Boolean).sort((a,b) => b!.mtime-a!.mtime).slice(0,8) });
  });
  // Discovery + custom agents — separate root so it can't collide with /api/agents/:id
  app.get('/api/agents-discovered', async (c) => {
    return c.json({ ok: true, candidates: await discoveryCache.get("all", discoverAgents).catch(() => []) });
  });

  app.post('/api/agents-discovered/add', async (c) => {
    const { name, dir, bin } = await reqJson<{ name?: string; dir?: string; bin?: string }>(c);
    const r = await addCustomAgent((name || '').trim(), (dir || '').trim().replace(/\/+$/, ''), (bin || '').trim());
    return r.ok ? c.json(r) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents-discovered/dismiss', async (c) => {
    const { dir } = await reqJson<{ dir?: string }>(c);
    const r = await dismissCandidate((dir || '').trim().replace(/\/+$/, ''));
    return r.ok ? c.json(r) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents-discovered/remove', async (c) => {
    const { id } = await reqJson<{ id?: string }>(c);
    const r = await removeCustomAgent(id || '');
    return r.ok ? c.json(r) : c.json({ ok: false, error: r.error }, 400);
  });

  app.get('/api/agent-docs', async (c) => {
    const { docs, missing } = await listAgentDocs();
    return c.json({ ok: true, docs, missing });
  });

  app.post('/api/agent-docs/create', async (c) => {
    const { dir } = await reqJson<{ dir?: string }>(c);
    const r = await createAgentDoc(dir || '');
    if(r.ok)recordEvent('agent','Documento de agente creado',r.path,{section:'agents',params:{id:'__docs'}});
    return r.ok ? c.json({ ok: true, path: r.path }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.get('/api/agents-search', async (c) => {
    const q = (c.req.query('q') || '').toLowerCase().trim().slice(0, 80);
    if (q.length < 2) return c.json({ ok: true, matches: [] });
    // keystroke-heavy endpoint: TTL + single-flight via SnapshotCache keeps a
    // burst of keystrokes from spawning a full fs scan per letter; the entry
    // cap bounds the distinct queries remembered.
    const matches = await searchCache.get(q, async () => {
      const results: { agent: string; agentName: string; kind: string; key: string; name: string; enabled: boolean }[] = [];
      await Promise.all(allDefs().map(async (def) => {
        const hasBin = def.bin ? (await hostExec(`command -v ${def.bin}`, { user: 'user', timeoutMs: 10_000 })).ok : false;
        const hasConfig = await hostExists(def.configRoot());
        if (!hasBin && !hasConfig && !def.shared) return;
        const [skills, mcps, plugins] = await Promise.all([scanSkills(def), scanMcps(def), scanPlugins(def)]);
        for (const it of [...skills, ...mcps, ...plugins]) {
          if (it.name.toLowerCase().includes(q) || it.key.toLowerCase().includes(q)) {
            results.push({ agent: def.id, agentName: def.name, kind: it.kind, key: it.key, name: it.name, enabled: it.enabled });
          }
        }
      }));
      return results.slice(0, 40);
    });
    return c.json({ ok: true, matches });
  });

  app.get('/api/agents-matrix', async (c) => {
    const m = await mcpMatrix();
    return c.json({ ok: true, ...m });
  });

  app.post('/api/agents/:id/mcp-health', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { key } = await reqJson<{ key?: string }>(c);
    const r = await mcpHealth(def, key || '');
    return r.ok ? c.json(r) : c.json(r, 400);
  });

  // providers: normalized list (keys masked), health probe, copy across agents
  app.get('/api/agents/:id/providers', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const pds = await extractProviders(def);
    return c.json({
      ok: true,
      providers: pds.map((p) => ({
        key: p.key, name: p.name, api: p.api, baseUrl: p.baseUrl,
        hasKey: p.hasKey, envRef: p.envRef, models: p.models, source: p.source,
        health: cachedProviderCheck(def.id, p.key),
      })),
    });
  });

  app.post('/api/agents/:id/providers/:key/check', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const r = await checkProvider(def.id, c.req.param('key'));
    return c.json({ ok: true, check: r });
  });

  app.post('/api/agents/:id/providers/:key/copy', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { target } = await reqJson<{ target?: string }>(c);
    if (!target) return c.json({ ok: false, error: 'Falta el agente destino' }, 400);
    const r = await copyProvider(def.id, c.req.param('key'), target);
    if (r.ok) { invalidateAgentsCache(); const destination=agentById(target);if(destination)recordEvent('agent',`${destination.name}: Provider copiado desde ${def.name}`,undefined,{section:'agents',params:{id:target,tab:'provider'}}); }
    return r.ok ? c.json({ ok: true, note: r.note }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.get('/api/agents/:id/backups', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    return c.json({ ok: true, backups: await agentBackups(def) });
  });

  app.post('/api/agents/:id/restore-backup', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { path } = await reqJson<{ path?: string }>(c);
    const r = await restoreBackup(def, path || '');
    if (r.ok) { invalidateAgentsCache(); docsCache = null; }
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.get('/api/agents/:id/settings', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const s = await getSettings(def);
    if (!s) return c.json({ ok: false, error: 'Este agente no tiene archivo de config gestionable' }, 404);
    return c.json({ ok: true, ...s });
  });

  app.post('/api/agents/:id/settings', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { key, value } = await reqJson<{ key: string; value: unknown }>(c);
    const r = await setSetting(def, key || '', value);
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.get('/api/agents', async (c) => {
    const snapshot = await listAgents(), programs = new Map(peekPrograms().map(p=>[p.id,p]));
    const agents = snapshot.map(a=>{ const p=programs.get(a.programId || '');return p ? {...a,version:p.version || a.version,latestVersion:p.latestVersion,auth:p.auth || a.auth} : a; });
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
    const { kind, key, enabled } = await reqJson<{ kind: string; key: string; enabled: boolean }>(c);
    if (!okKey(key)) return c.json({ ok: false, error: 'Clave inválida' }, 400);
    const r =
      kind === 'mcp' ? await toggleMcp(def, key, !!enabled)
      : kind === 'plugin' ? await togglePlugin(def, key, !!enabled)
      : kind === 'skill' ? await toggleSkill(def, key, !!enabled)
      : { ok: false, error: 'Tipo desconocido' };
    if (r.ok) invalidateAgentsCache();
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents/:id/delete', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { kind, key } = await reqJson<{ kind: string; key: string }>(c);
    if (!okKey(key)) return c.json({ ok: false, error: 'Clave inválida' }, 400);
    const r = await deleteItem(def, kind, key);
    if (r.ok) invalidateAgentsCache();
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents/:id/add-skill', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { name, desc, body } = await reqJson<{ name: string; desc?: string; body?: string }>(c);
    const r = await addSkill(def, name || '', desc || '', body || '');
    if (r.ok) invalidateAgentsCache();
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });

  app.post('/api/agents/:id/add-mcp', async (c) => {
    const def = agentById(c.req.param('id'));
    if (!def) return c.json({ ok: false, error: 'Agente desconocido' }, 404);
    const { name, url, command, args } = await reqJson<{ name: string; url?: string; command?: string; args?: string }>(c);
    const r = await addMcp(def, name || '', url || '', command || '', args || '');
    if (r.ok) invalidateAgentsCache();
    return r.ok ? c.json({ ok: true }) : c.json({ ok: false, error: r.error }, 400);
  });
}
