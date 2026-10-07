import { realpath, stat } from 'node:fs/promises';
import { HOST_FS, HOST_USER, containerToHost, hostExec } from './host';
import type { ProgramDef, ProgramView } from './types';

// Optional account/integration metadata and install recommendations. This list
// never defines inventory, versions, candidates or update commands. Native
// installation records live in software.ts and software-host.py.
function selectedAccountCheck(agent: string, fallback: string): string {
  const decode = "import json,sys;d=json.load(sys.stdin);p=next(p for p in d['profiles'] if p['active']);print((p.get('email') or p['label']) if p['connected'] else '');sys.exit(0 if p['connected'] else 1)";
  return `if [ -x "$HOME/.local/bin/axon-agent" ]; then "$HOME/.local/bin/axon-agent" status ${agent} | python3 -c "${decode}"; else ${fallback}; fi`;
}

const INTEGRATIONS: ProgramDef[] = [
  // --- AI / dev CLIs ---
  {
    id: 'codex',
    name: 'Codex CLI',
    icon: 'bot',
    desc: 'OpenAI Codex CLI (pnpm global).',
    channel: 'pnpm',
    npmPkg: '@openai/codex',
    detect: [{ cmd: 'command -v codex', user: 'user' }],
    version: { cmd: 'codex --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: selectedAccountCheck('codex', 'python3 -c "import json,base64;d=json.load(open(\'$HOME/.codex/auth.json\'));t=d.get(\'tokens\',{});tok=t.get(\'id_token\') or t.get(\'access_token\');p=tok.split(\'.\')[1];p+=\'=\'*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p)).get(\'email\',\'cuenta\'))" 2>/dev/null'), user: 'user' },
      login: [{ label: 'codex login (device)', cmd: 'codex login --device-auth', user: 'user' }],
      logout: [{ label: 'codex logout', cmd: 'codex logout', user: 'user' }],
    },
    steps: [],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: 'sparkles',
    channel: 'pnpm',
    npmPkg: '@anthropic-ai/claude-code',
    detect: [{ cmd: 'command -v claude', user: 'user' }],
    version: { cmd: 'claude --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: selectedAccountCheck('claude', 'e=$(python3 -c "import json;print(json.load(open(\'$HOME/.claude.json\')).get(\'oauthAccount\',{}).get(\'emailAddress\',\'\'))" 2>/dev/null); [ -n "$e" ] && echo "$e"'), user: 'user' },
      logout: [
        { label: 'Borrar credenciales', cmd: 'rm -f $HOME/.claude/.credentials.json', user: 'user' },
        { label: 'Limpiar cuenta', cmd: 'python3 -c "import json;p=\'$HOME/.claude.json\';d=json.load(open(p));d.pop(\'oauthAccount\',None);json.dump(d,open(p,\'w\'))"', user: 'user' },
      ],
      loginHint: 'Abrí una terminal, ejecutá `claude` y usá /login',
    },
    steps: [],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: 'square-terminal',
    channel: 'pnpm',
    npmPkg: '@opencode/cli',
    detect: [{ cmd: 'command -v opencode', user: 'user' }],
    version: { cmd: 'opencode --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: 'python3 -c "import json,sys;k=list(json.load(open(\'$HOME/.local/share/opencode/auth.json\')).keys());print(\', \'.join(k));sys.exit(0 if k else 1)" 2>/dev/null', user: 'user' },
      loginHint: 'Ejecutá `opencode auth login` en una terminal (es interactivo)',
    },
    steps: [],
  },
  {
    id: 'mpcli',
    name: 'Mercado Pago CLI',
    icon: 'hand-coins',
    desc: 'mpcli — CLI oficial de Mercado Pago (binario en ~/.local/bin).',
    channel: 'script',
    npmPkg: 'mercadopago-cli', // proxy para detectar la última versión publicada
    detect: [{ cmd: 'command -v mpcli', user: 'user' }],
    version: { cmd: 'mpcli --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: "mpcli config list --silent 2>/dev/null | grep -i 'active profile' | head -1", user: 'user' },
      logout: [{ label: 'mpcli logout', cmd: 'mpcli logout', user: 'user' }],
      loginHint: 'Ejecutá `mpcli login --token APP_USR-...` en una terminal (guarda en el keychain del sistema)',
    },
    // Binario standalone en ~/.local/bin: la forma oficial de instalar/actualizar
    // es el install script del tap de Homebrew (también existe mercadopago-cli en npm).
    steps: [],
  },
  {
    id: 'devin',
    name: 'Devin CLI',
    icon: 'brain-circuit',
    channel: 'script',
    detect: [{ cmd: 'command -v devin', user: 'user' }],
    version: { cmd: 'devin --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: 'devin auth status 2>/dev/null | grep -iE "logged in|account|@" | head -1', user: 'user' },
      login: [{ label: 'devin auth login', cmd: 'devin auth login', user: 'user' }],
      logout: [{ label: 'devin auth logout', cmd: 'devin auth logout', user: 'user' }],
    },
    steps: [],
  },
  {
    id: 'openchamber',
    name: 'OpenChamber',
    icon: 'brain',
    channel: 'bun',
    npmPkg: '@openchamber/web',
    detect: [{ cmd: 'command -v openchamber', user: 'user' }],
    version: { cmd: 'openchamber --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: '[ -f $HOME/.config/openchamber/github-auth.json ] && echo "GitHub vinculado"', user: 'user' },
      loginHint: 'Se gestiona desde la UI de OpenChamber (Integraciones)',
    },
    steps: [],
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    icon: 'gem',
    channel: 'pnpm',
    npmPkg: '@google/gemini-cli',
    detect: [{ cmd: 'command -v gemini', user: 'user' }],
    version: { cmd: 'gemini --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: 'e=$(python3 -c "import json;print(json.load(open(\'$HOME/.gemini/google_accounts.json\'))[\'accounts\'][0][\'email\'])" 2>/dev/null); if [ -n "$e" ]; then echo "$e"; elif [ -f $HOME/.gemini/oauth_creds.json ]; then echo "logueado"; else exit 1; fi', user: 'user' },
      logout: [{ label: 'Borrar credenciales', cmd: 'rm -f $HOME/.gemini/oauth_creds.json $HOME/.gemini/google_accounts.json', user: 'user' }],
      loginHint: 'Ejecutá `gemini` en una terminal y elegí login con Google',
    },
    steps: [],
  },
  {
    id: 'vercel',
    name: 'Vercel CLI',
    icon: 'triangle',
    channel: 'pnpm',
    npmPkg: 'vercel',
    detect: [{ cmd: 'command -v vercel', user: 'user' }],
    version: { cmd: 'vercel --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: 'vercel whoami 2>/dev/null | tail -1', user: 'user' },
      logout: [{ label: 'vercel logout', cmd: 'vercel logout', user: 'user' }],
      loginHint: 'Ejecutá `vercel login` en una terminal (te manda un mail o abre GitHub)',
    },
    steps: [],
  },
  {
    id: 'supabase',
    name: 'Supabase CLI',
    icon: 'database',
    channel: 'pnpm',
    npmPkg: 'supabase',
    detect: [{ cmd: 'command -v supabase', user: 'user' }],
    version: { cmd: 'supabase --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: '[ -s $HOME/.supabase/access-token ] && echo "access token configurado"', user: 'user' },
      logout: [{ label: 'supabase logout', cmd: 'supabase logout', user: 'user' }],
      loginHint: 'Generá un token en supabase.com y ejecutá `supabase login`',
    },
    steps: [],
  },
  {
    id: 'shopify',
    name: 'Shopify CLI',
    icon: 'shopping-bag',
    channel: 'pnpm',
    npmPkg: '@shopify/cli',
    detect: [{ cmd: 'command -v shopify', user: 'user' }],
    version: { cmd: 'shopify version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: 'find $HOME/.config/shopify -name "*.json" 2>/dev/null | grep -q . && echo "sesión guardada"', user: 'user' },
      loginHint: 'Ejecutá `shopify app dev` o `shopify theme dev` dentro de un proyecto para autenticar',
    },
    steps: [],
  },
  {
    id: 'playwright',
    name: 'Playwright (CLI + MCP)',
    icon: 'flask-conical',
    channel: 'pnpm',
    npmPkg: '@playwright/cli',
    detect: [{ cmd: 'command -v playwright-cli || command -v playwright', user: 'user' }],
    version: { cmd: 'playwright-cli --version 2>/dev/null | head -1 || playwright --version 2>/dev/null | head -1', user: 'user' },
    steps: [],
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    icon: 'git-branch',
    channel: 'apt',
    detect: [{ cmd: 'command -v gh', user: 'user' }],
    version: { cmd: 'gh --version 2>/dev/null | head -1', user: 'user' },
    auth: {
      check: { cmd: 'gh auth status 2>/dev/null | grep -oE "account [^ ]+" | head -1 | cut -d" " -f2', user: 'user' },
      login: [{ label: 'gh auth login (device)', cmd: 'gh auth login --hostname github.com --web --git-protocol ssh', user: 'user' }],
      logout: [{ label: 'gh auth logout', cmd: 'gh auth logout --hostname github.com --user "$(gh api user --jq .login 2>/dev/null)"', user: 'user' }],
    },
    steps: [],
  },
  // --- Desktop apps ---
  {
    id: 'chatgpt',
    name: 'ChatGPT desktop',
    icon: 'message-square',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s chatgpt', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' chatgpt", user: 'root' },
    steps: [],
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    icon: 'globe',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s google-chrome-stable', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' google-chrome-stable", user: 'root' },
    steps: [],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    icon: 'code',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s code', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' code", user: 'root' },
    steps: [],
  },
  {
    id: 'code-server',
    name: 'code-server',
    icon: 'server',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s code-server', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' code-server", user: 'root' },
    steps: [],
  },
  {
    id: 'cloudflared',
    name: 'cloudflared',
    icon: 'cloud',
    channel: 'apt',
    detect: [{ cmd: 'command -v cloudflared', user: 'root' }],
    version: { cmd: 'cloudflared --version 2>/dev/null | head -1', user: 'root' },
    steps: [],
  },
  // --- Runtimes & package managers ---
  {
    id: 'node',
    name: 'Node.js',
    icon: 'hexagon',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s nodejs', user: 'root' }],
    version: { cmd: 'node --version', user: 'user' },
    steps: [],
  },
  {
    id: 'bun',
    name: 'Bun',
    icon: 'circle-dashed',
    channel: 'bun',
    detect: [{ cmd: 'command -v bun', user: 'user' }],
    version: { cmd: 'bun --version', user: 'user' },
    steps: [],
  },
  {
    id: 'uv',
    name: 'uv (Python)',
    icon: 'rocket',
    channel: 'uv',
    detect: [{ cmd: 'command -v uv', user: 'user' }],
    version: { cmd: 'uv --version', user: 'user' },
    steps: [],
  },
  {
    id: 'pipx',
    name: 'pipx apps',
    icon: 'package-open',
    channel: 'pipx',
    detect: [{ cmd: 'command -v pipx', user: 'user' }],
    version: { cmd: 'pipx --version', user: 'user' },
    steps: [],
  },
  {
    id: 'rustup',
    name: 'Rust (rustup)',
    icon: 'cog',
    channel: 'cargo',
    detect: [{ cmd: 'command -v rustup', user: 'user' }],
    version: { cmd: 'rustc --version', user: 'user' },
    steps: [],
  },
  {
    id: 'cargo-tools',
    name: 'Herramientas Cargo',
    icon: 'wrench',
    channel: 'cargo',
    detect: [{ cmd: 'command -v cargo-install-update', user: 'user' }],
    steps: [],
  },
  // --- System-wide ---
  {
    id: 'apt',
    name: 'Sistema (APT)',
    icon: 'package',
    desc: 'Todos los paquetes .deb del sistema operativo, incluyendo phased updates.',
    channel: 'apt',
    detect: [{ cmd: 'command -v apt-get', user: 'root' }],
    steps: [],
  },
  {
    id: 'snap',
    name: 'Snap packages',
    icon: 'boxes',
    desc: 'Firefox, Chromium y otros snaps.',
    channel: 'snap',
    detect: [{ cmd: 'command -v snap', user: 'root' }],
    steps: [],
  },
  {
    id: 'docker',
    name: 'Docker Engine',
    icon: 'container',
    channel: 'apt',
    desc: 'docker.io + containerd + compose (paquetes Ubuntu).',
    detect: [{ cmd: 'dpkg -s docker.io || command -v docker', user: 'root' }],
    version: { cmd: 'docker --version', user: 'root' },
    steps: [],
  },
  {
    id: 'pnpm-globals',
    name: 'Todas las globales pnpm',
    icon: 'layers',
    desc: 'Actualiza pnpm y todas las CLIs instaladas con pnpm add -g a la vez.',
    channel: 'pnpm',
    detect: [{ cmd: 'command -v pnpm', user: 'user' }],
    version: { cmd: 'pnpm --version', user: 'user' },
    auth: {
      check: { cmd: 'pnpm whoami 2>/dev/null', user: 'user' },
      loginHint: 'Ejecutá `pnpm login` en una terminal',
    },
    steps: [],
  },
];

export function programDefinitions(): readonly ProgramDef[] { return INTEGRATIONS; }

export function programById(id: string): ProgramDef | undefined {
  return INTEGRATIONS.find((p) => p.id === id);
}

// Program id → icon path. Prefer real product icons: vendored Simple Icons
// SVGs (CC0) under /icons/, or the app's own desktop icon via /api/icons/.
// Programs without either fall back to their Lucide `icon`.
const BRAND_ICONS: Record<string, string> = {
  codex: '/icons/openai.svg',
  'claude-code': '/icons/claudecode.svg',
  opencode: '/api/icons/ai.opencode.desktop',
  devin: '/api/icons/devin-desktop',
  mpcli: '/icons/mercadopago.svg',
  gemini: '/icons/googlegemini.svg',
  vercel: '/icons/vercel.svg',
  supabase: '/icons/supabase.svg',
  shopify: '/icons/shopify.svg',
  playwright: '/icons/playwright.svg',
  gh: '/icons/github.svg',
  chatgpt: '/api/icons/chatgpt',
  chrome: '/icons/googlechrome.svg',
  vscode: '/api/icons/vscode',
  'code-server': '/icons/coder.svg',
  cloudflared: '/icons/cloudflare.svg',
  node: '/icons/nodedotjs.svg',
  bun: '/icons/bun.svg',
  uv: '/icons/uv.svg',
  pipx: '/icons/pipx.svg',
  rustup: '/icons/rust.svg',
  'cargo-tools': '/icons/rust.svg',
  apt: '/icons/ubuntu.svg',
  snap: '/icons/snapcraft.svg',
  docker: '/icons/docker.svg',
  'pnpm-globals': '/icons/pnpm.svg',
};

async function programMetadata(p: ProgramDef,inspectVersion=true) {
  const [v, a] = await Promise.all([
    p.version && inspectVersion ? hostExec(p.version.cmd, { user: p.version.user, timeoutMs: 15_000 }) : null,
    p.auth ? hostExec(p.auth.check.cmd, { user: p.auth.check.user, timeoutMs: 15_000 }) : null,
  ]);
  return {
    version: v?.ok ? v.stdout.trim().split('\n')[0] || undefined : undefined,
    auth: p.auth ? {
      loggedIn: !!(a?.ok && a.stdout.trim()),
      account: a?.ok ? a.stdout.trim().split('\n')[0] || undefined : undefined,
      canLogin: !!p.auth.login, canLogout: !!p.auth.logout, loginHint: p.auth.loginHint,
    } : undefined,
    metadataPending: false,
  };
}

export async function detectPrograms(checkUpdates = false, inspect = true, probe = hostExec): Promise<ProgramView[]> {
  return Promise.all(INTEGRATIONS.map(async p => {
    let installed = true;
    for (const d of p.detect) {
      if (!(await probe(d.cmd, { user:d.user, timeoutMs:15_000 })).ok) { installed=false; break; }
    }
    const view: ProgramView = {
      id:p.id, name:p.name, icon:p.icon, brandIcon:BRAND_ICONS[p.id], desc:p.desc,
      channel:p.channel, installed,
      installable:!!p.npmPkg && p.channel==='pnpm' && p.id!=='opencode', packageName:p.npmPkg,
      steps:p.steps.map(s=>({label:s.label, cmd:s.cmd, user:s.user})),
      metadataPending: installed && !!(p.version || p.auth) && !inspect,
    };
    if (!installed || !inspect) return view;
    Object.assign(view, await programMetadata(p));
    return view;
  }));
}

// --- Shared stale-while-revalidate cache ---
// Installation probes return first; local versions/accounts and registry checks
// complete in the background. Both /api/programs and the agents rail need the result, so it
// lives here in one place: fresh hits are instant, stale hits return the last
// data immediately and recompute in the background.
let progCache: { at: number; data: ProgramView[] } | null = null;
let progGeneration = 0;
let metadataInflight: Promise<void> | null = null;
let progInflight: Promise<ProgramView[]> | null = null;
const PROG_TTL_MS = 60_000;

export function invalidateProgramsCache(): void {
  progGeneration++;
  progCache = null;
  progInflight = null;
  metadataInflight = null;
}

export function peekPrograms(): ProgramView[] { return progCache?.data || []; }
export function programsStatus() { return { checkingMetadata: !!metadataInflight, checkingUpdates: false, checkedAt: progCache?.at || 0 }; }
function hydratePrograms(data: ProgramView[], generation: number): void {
  const flight=Promise.all(data.filter(p=>p.installed && p.metadataPending).map(async view=>{
    const next=await programMetadata(programById(view.id)!,false);
    if(generation===progGeneration && progCache?.data===data)Object.assign(view,{auth:next.auth,metadataPending:false});
  })).then(()=>{}).finally(()=>{if(metadataInflight===flight)metadataInflight=null;});
  metadataInflight=flight;
}
function refreshPrograms(): Promise<ProgramView[]> {
  if (!progInflight) {
    const generation = progGeneration;
    const flight = import('./software').then(async ({software}) => {
      const inventory = await software.get();
      const data: ProgramView[] = INTEGRATIONS.map(def => {
        const records = inventory.installations.filter(p => p.integrationId === def.id);
        const selected = records.find(p => p.user === HOST_USER && p.scope === 'user') || records[0];
        return {id:def.id,name:def.name,desc:def.desc,icon:def.icon,channel:(selected?.manager || def.channel) as ProgramView['channel'],steps:[],installed:!!selected,version:selected?.version || undefined,brandIcon:selected?.iconUrl || BRAND_ICONS[def.id],metadataPending:!!selected && !!def.auth,installable:!!def.npmPkg && def.channel==='pnpm' && def.id!=='opencode',packageName:def.npmPkg,latestVersion:records.length===1&&selected?.canUpdate?selected.targetVersion:undefined};
      });
      if(generation === progGeneration) {progCache={at:Date.now(),data};hydratePrograms(data,generation);}
      return data;
    }).finally(() => {if(progInflight===flight)progInflight=null;});
    progInflight=flight;
  }
  return progInflight;
}
// Accounts remain optional integrations. Installation and update state comes
// exclusively from native package records, not from this list of integrations.
export async function getPrograms(force=false):Promise<ProgramView[]> {
  if(force)invalidateProgramsCache();
  if(progCache && Date.now()-progCache.at<PROG_TTL_MS)return progCache.data;
  return refreshPrograms();
}
export function warmProgramsCache():void {refreshPrograms().catch(()=>{});}

// Legacy package search and icon endpoints used by optional integrations.

export async function searchAptPackages(filter: string): Promise<{ name: string; version: string }[]> {
  const safe = filter.replace(/[^a-zA-Z0-9._+-]/g, '');
  const res = await hostExec(
    `dpkg-query -f='\${binary:Package}\t\${Version}\n' -W ${safe ? `'*${safe}*'` : ''} 2>/dev/null | head -200`,
    { user: 'root', timeoutMs: 30_000 }
  );
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, version] = l.split('\t');
      return { name, version: version || '' };
    });
}

// Resolve a .desktop Icon= name/path to a servable file under /hostfs.
// Apps install icons into <icon-root>/<theme>/<size>/apps — 'hicolor' is the
// fallback theme every theme inherits, so covering it (system + flatpak +
// user-local roots) resolves virtually every packaged icon.
const ICON_EXTS = ['.png', '.svg', '.xpm'];
const ICON_SIZES = ['scalable', '256x256', '128x128', '96x96', '64x64', '48x48', '32x32', '24x24', '16x16'];
const iconDirs = () => {
const roots = [
  '/usr/share/icons',
  '/usr/local/share/icons',
  '/var/lib/flatpak/exports/share/icons',
  `${HOST_USER === 'root' ? '/root' : `/home/${HOST_USER}`}/.local/share/icons`,
];
return [
  '/usr/share/pixmaps',
  '/usr/local/share/pixmaps',
  `${HOST_USER === 'root' ? '/root' : `/home/${HOST_USER}`}/.local/share/pixmaps`,
  ...roots.flatMap((r) => ICON_SIZES.map((s) => `${r}/hicolor/${s}/apps`)),
  '/var/lib/snapd/desktop/icons',
  '/snap/icons',
];
};

// Roots an icon file may resolve to — mirrors the native resolver's policy:
// theme roots, pixmaps dirs and packaged-icon stores only.
const iconRoots = () => {
  const home = HOST_USER === 'root' ? '/root' : `/home/${HOST_USER}`;
  return [
    '/usr/share/icons',
    '/usr/local/share/icons',
    '/var/lib/flatpak/exports/share/icons',
    `${home}/.local/share/icons`,
    '/usr/share/pixmaps',
    '/usr/local/share/pixmaps',
    `${home}/.local/share/pixmaps`,
    '/var/lib/snapd/desktop/icons',
    '/snap/icons',
  ];
};

export async function resolveIcon(iconName: string): Promise<string | null> {
  if (!iconName || iconName.includes('..') || iconName.includes('\0')) return null;
  // Absolute path (desktop entries may store one) — only serve real image
  // files so the endpoint can't read arbitrary host files.
  if (iconName.startsWith('/')) {
    if (!/\.(png|svg|xpm|ico|jpe?g|webp)$/i.test(iconName)) return null;
    const p = await hostIconFile(iconName);
    if (p) return p;
  }
  for (const dir of iconDirs()) {
    for (const ext of ICON_EXTS) {
      const candidate = `${dir}/${iconName}${ext}`;
      const p = await hostIconFile(candidate);
      if (p) return p;
    }
  }
  return null;
}

// Resolve symlinks, then require the real path to stay under a known icon
// root — otherwise an Icon= entry (or a hostile symlink inside one) could
// point this endpoint at any image-looking file on the host.
async function hostIconFile(hostPath: string): Promise<string | null> {
  try {
    const real = await realpath(`${HOST_FS}${hostPath}`);
    const host = containerToHost(real);
    if (!(await stat(real)).isFile()) return null;
    return iconRoots().some((root) => host === root || host.startsWith(root + '/')) ? real : null;
  } catch {
    return null;
  }
}
