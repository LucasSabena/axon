import { readdir } from 'fs/promises';
import * as path from 'path';
import { HOST_FS, hostExec, readHostFile } from './host';
import type { DesktopApp, ProgramDef, ProgramView } from './types';

// Registry of updatable programs. Each step declares which user runs it on the
// host: root for system package managers, `user` for user-level tools whose
// binaries live in ~/.local, ~/.bun, etc.
// `npmPkg` marks pnpm-global packages: their latest version is resolved via
// `npm view` so the card can show "current → latest".
const PROGRAMS: ProgramDef[] = [
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
      check: { cmd: 'python3 -c "import json,base64;d=json.load(open(\'$HOME/.codex/auth.json\'));t=d.get(\'tokens\',{});tok=t.get(\'id_token\') or t.get(\'access_token\');p=tok.split(\'.\')[1];p+=\'=\'*(-len(p)%4);print(json.loads(base64.urlsafe_b64decode(p)).get(\'email\',\'cuenta\'))" 2>/dev/null', user: 'user' },
      login: [{ label: 'codex login (device)', cmd: 'codex login --device-auth', user: 'user' }],
      logout: [{ label: 'codex logout', cmd: 'codex logout', user: 'user' }],
    },
    steps: [{ label: 'pnpm update codex', cmd: 'pnpm add -g @openai/codex@latest', user: 'user' }],
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
      check: { cmd: 'e=$(python3 -c "import json;print(json.load(open(\'$HOME/.claude.json\')).get(\'oauthAccount\',{}).get(\'emailAddress\',\'\'))" 2>/dev/null); [ -n "$e" ] && echo "$e"', user: 'user' },
      logout: [
        { label: 'Borrar credenciales', cmd: 'rm -f $HOME/.claude/.credentials.json', user: 'user' },
        { label: 'Limpiar cuenta', cmd: 'python3 -c "import json;p=\'$HOME/.claude.json\';d=json.load(open(p));d.pop(\'oauthAccount\',None);json.dump(d,open(p,\'w\'))"', user: 'user' },
      ],
      loginHint: 'Abrí una terminal, ejecutá `claude` y usá /login',
    },
    steps: [{ label: 'pnpm update claude-code', cmd: 'pnpm add -g @anthropic-ai/claude-code@latest', user: 'user' }],
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
    // opencode-sync actualiza el binario Y reinicia los servicios systemd del TUI.
    // NUNCA usar pnpm add -g opencode-ai directamente (regla del host).
    steps: [{ label: 'opencode-sync', cmd: 'opencode-sync', user: 'user' }],
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
    steps: [{ label: 'install script mpcli', cmd: 'curl -fsSL https://raw.githubusercontent.com/mercadopago/homebrew-tap/main/install.sh | sh', user: 'user' }],
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
    steps: [{ label: 'devin update', cmd: 'yes | devin update', user: 'user' }],
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
    steps: [{ label: 'bun update openchamber', cmd: 'bun add -g @openchamber/web@latest', user: 'user' }],
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
    steps: [{ label: 'pnpm update gemini-cli', cmd: 'pnpm add -g @google/gemini-cli@latest', user: 'user' }],
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
    steps: [{ label: 'pnpm update vercel', cmd: 'pnpm add -g vercel@latest', user: 'user' }],
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
    steps: [{ label: 'pnpm update supabase', cmd: 'pnpm add -g supabase@latest', user: 'user' }],
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
    steps: [{ label: 'pnpm update shopify', cmd: 'pnpm add -g @shopify/cli@latest', user: 'user' }],
  },
  {
    id: 'playwright',
    name: 'Playwright (CLI + MCP)',
    icon: 'flask-conical',
    channel: 'pnpm',
    npmPkg: '@playwright/cli',
    detect: [{ cmd: 'command -v playwright-cli || command -v playwright', user: 'user' }],
    version: { cmd: 'playwright-cli --version 2>/dev/null | head -1 || playwright --version 2>/dev/null | head -1', user: 'user' },
    steps: [{ label: 'pnpm update playwright', cmd: 'pnpm add -g @playwright/cli@latest @playwright/mcp@latest', user: 'user' }],
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
    steps: [{ label: 'apt upgrade gh', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y gh', user: 'root' }],
  },
  // --- Desktop apps ---
  {
    id: 'chatgpt',
    name: 'ChatGPT desktop',
    icon: 'message-square',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s chatgpt', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' chatgpt", user: 'root' },
    steps: [{ label: 'Actualizar ChatGPT', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y chatgpt', user: 'root' }],
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    icon: 'globe',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s google-chrome-stable', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' google-chrome-stable", user: 'root' },
    steps: [{ label: 'Actualizar Chrome', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y google-chrome-stable', user: 'root' }],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    icon: 'code',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s code', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' code", user: 'root' },
    steps: [{ label: 'Actualizar VS Code', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y code', user: 'root' }],
  },
  {
    id: 'code-server',
    name: 'code-server',
    icon: 'server',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s code-server', user: 'root' }],
    version: { cmd: "dpkg-query -W -f='${Version}' code-server", user: 'root' },
    steps: [{ label: 'Actualizar code-server', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y code-server', user: 'root' }],
  },
  {
    id: 'cloudflared',
    name: 'cloudflared',
    icon: 'cloud',
    channel: 'apt',
    detect: [{ cmd: 'command -v cloudflared', user: 'root' }],
    version: { cmd: 'cloudflared --version 2>/dev/null | head -1', user: 'root' },
    steps: [{ label: 'Actualizar cloudflared', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y cloudflared || cloudflared update', user: 'root' }],
  },
  // --- Runtimes & package managers ---
  {
    id: 'node',
    name: 'Node.js',
    icon: 'hexagon',
    channel: 'apt',
    detect: [{ cmd: 'dpkg -s nodejs', user: 'root' }],
    version: { cmd: 'node --version', user: 'user' },
    steps: [{ label: 'Actualizar Node.js', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y nodejs', user: 'root' }],
  },
  {
    id: 'bun',
    name: 'Bun',
    icon: 'circle-dashed',
    channel: 'bun',
    detect: [{ cmd: 'command -v bun', user: 'user' }],
    version: { cmd: 'bun --version', user: 'user' },
    steps: [{ label: 'bun upgrade', cmd: 'bun upgrade', user: 'user' }],
  },
  {
    id: 'uv',
    name: 'uv (Python)',
    icon: 'rocket',
    channel: 'uv',
    detect: [{ cmd: 'command -v uv', user: 'user' }],
    version: { cmd: 'uv --version', user: 'user' },
    steps: [
      { label: 'uv self update', cmd: 'uv self update', user: 'user' },
      { label: 'uv tools', cmd: 'uv tool upgrade --all', user: 'user' },
    ],
  },
  {
    id: 'pipx',
    name: 'pipx apps',
    icon: 'package-open',
    channel: 'pipx',
    detect: [{ cmd: 'command -v pipx', user: 'user' }],
    version: { cmd: 'pipx --version', user: 'user' },
    steps: [{ label: 'pipx upgrade-all', cmd: 'pipx upgrade-all', user: 'user' }],
  },
  {
    id: 'rustup',
    name: 'Rust (rustup)',
    icon: 'cog',
    channel: 'cargo',
    detect: [{ cmd: 'command -v rustup', user: 'user' }],
    version: { cmd: 'rustc --version', user: 'user' },
    steps: [{ label: 'rustup update', cmd: 'rustup update', user: 'user' }],
  },
  {
    id: 'cargo-tools',
    name: 'Herramientas Cargo',
    icon: 'wrench',
    channel: 'cargo',
    detect: [{ cmd: 'command -v cargo-install-update', user: 'user' }],
    steps: [{ label: 'cargo install-update', cmd: 'cargo install-update -a', user: 'user' }],
  },
  // --- System-wide ---
  {
    id: 'apt',
    name: 'Sistema (APT)',
    icon: 'package',
    desc: 'Todos los paquetes .deb del sistema operativo, incluyendo phased updates.',
    channel: 'apt',
    detect: [{ cmd: 'command -v apt-get', user: 'root' }],
    updatesCheck: { cmd: "apt list --upgradable 2>/dev/null | tail -n +2 | wc -l", user: 'root' },
    steps: [
      { label: 'apt update', cmd: 'apt-get update', user: 'root' },
      { label: 'apt upgrade', cmd: 'DEBIAN_FRONTEND=noninteractive apt-get -o APT::Get::Always-Include-Phased-Updates=true upgrade -y', user: 'root' },
      { label: 'autoremove', cmd: 'DEBIAN_FRONTEND=noninteractive apt-get autoremove -y', user: 'root' },
    ],
  },
  {
    id: 'snap',
    name: 'Snap packages',
    icon: 'boxes',
    desc: 'Firefox, Chromium y otros snaps.',
    channel: 'snap',
    detect: [{ cmd: 'command -v snap && snap list', user: 'root' }],
    updatesCheck: { cmd: "snap refresh --list 2>/dev/null | tail -n +2 | wc -l", user: 'root' },
    steps: [{ label: 'snap refresh', cmd: 'snap refresh', user: 'root' }],
  },
  {
    id: 'docker',
    name: 'Docker Engine',
    icon: 'container',
    channel: 'apt',
    desc: 'docker.io + containerd + compose (paquetes Ubuntu).',
    detect: [{ cmd: 'dpkg -s docker.io || command -v docker', user: 'root' }],
    version: { cmd: 'docker --version', user: 'root' },
    steps: [{
      label: 'apt upgrade docker',
      cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y docker.io docker-compose-v2 containerd runc',
      user: 'root',
    }],
  },
  {
    id: 'pnpm-globals',
    name: 'Todas las globales pnpm',
    icon: 'layers',
    desc: 'Actualiza pnpm y todas las CLIs instaladas con pnpm add -g a la vez.',
    channel: 'pnpm',
    detect: [{ cmd: 'command -v pnpm', user: 'user' }],
    version: { cmd: 'pnpm --version', user: 'user' },
    updatesCheck: { cmd: "pnpm outdated -g --format json 2>/dev/null | grep -c '\"latest\"'", user: 'user' },
    auth: {
      check: { cmd: 'npm whoami 2>/dev/null', user: 'user' },
      loginHint: 'Ejecutá `npm login` en una terminal',
    },
    steps: [
      { label: 'Actualizar pnpm', cmd: 'pnpm self-update 2>/dev/null || pnpm add -g pnpm@latest', user: 'user' },
      { label: 'pnpm update -g', cmd: 'pnpm update -g --latest', user: 'user' },
    ],
  },
];

export function programById(id: string): ProgramDef | undefined {
  return PROGRAMS.find((p) => p.id === id);
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

function semverOf(s: string): string | null {
  return s.match(/\d+\.\d+\.\d+(?:[-+][0-9a-zA-Z.-]*)?/)?.[0] ?? null;
}

// a > b for dotted numeric versions (1.2.10 > 1.2.9)
function newerThan(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export async function detectPrograms(): Promise<ProgramView[]> {
  const views = await Promise.all(
    PROGRAMS.map(async (p) => {
      let installed = true;
      for (const d of p.detect) {
        const res = await hostExec(d.cmd, { user: d.user, timeoutMs: 15_000 });
        if (!res.ok) { installed = false; break; }
      }
      const view: ProgramView = {
        id: p.id,
        name: p.name,
        icon: p.icon,
        brandIcon: BRAND_ICONS[p.id],
        desc: p.desc,
        channel: p.channel,
        installed,
        steps: p.steps.map((s) => ({ label: s.label, cmd: s.cmd, user: s.user })),
      };
      if (installed && p.version) {
        const v = await hostExec(p.version.cmd, { user: p.version.user, timeoutMs: 15_000 });
        if (v.ok) view.version = v.stdout.trim().split('\n')[0] || undefined;
      }
      if (installed && p.updatesCheck) {
        const u = await hostExec(p.updatesCheck.cmd, { user: p.updatesCheck.user, timeoutMs: 60_000 });
        if (u.ok) {
          const n = parseInt(u.stdout.trim(), 10);
          if (!Number.isNaN(n) && n > 0) view.pendingUpdates = String(n);
        }
      }
      // Account/session state for account-backed CLIs
      if (installed && p.auth) {
        const a = await hostExec(p.auth.check.cmd, { user: p.auth.check.user, timeoutMs: 15_000 });
        view.auth = {
          loggedIn: a.ok && a.stdout.trim().length > 0,
          account: a.ok ? a.stdout.trim().split('\n')[0] || undefined : undefined,
          canLogin: !!p.auth.login,
          canLogout: !!p.auth.logout,
          loginHint: p.auth.loginHint,
        };
      }
      // npm-registry-backed tools: compare installed semver vs registry latest
      if (installed && p.npmPkg) {
        const latest = await hostExec(`npm view ${p.npmPkg} version 2>/dev/null`, { user: 'user', timeoutMs: 30_000 });
        const latestV = semverOf(latest.stdout.trim());
        const currentV = view.version ? semverOf(view.version) : null;
        if (latestV && currentV && newerThan(latestV, currentV)) {
          view.latestVersion = latestV;
        }
      }
      return view;
    })
  );
  return views;
}

// --- Installed programs inventory ---

export async function listDesktopApps(): Promise<DesktopApp[]> {
  const apps: DesktopApp[] = [];
  const dirs = [
    `${HOST_FS}/usr/share/applications`,
    `${HOST_FS}/var/lib/snapd/desktop/applications`,
    `${HOST_FS}/home/${process.env.HOST_USER || 'root'}/.local/share/applications`,
  ];
  const seen = new Set<string>();
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.desktop')) continue;
      try {
        const content = await readHostFile(path.join(dir.slice(HOST_FS.length), file));
        const name = content.match(/^Name=(.+)$/m)?.[1]?.trim();
        const exec = content.match(/^Exec=(.+)$/m)?.[1]?.trim();
        const icon = content.match(/^Icon=(.+)$/m)?.[1]?.trim();
        const noDisplay = /^NoDisplay=true/m.test(content);
        const hidden = /^Hidden=true/m.test(content);
        const isSnap = dir.includes('snapd');
        if (!name || noDisplay || hidden) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        apps.push({
          name,
          icon,
          exec: exec?.replace(/\s+%[a-zA-Z]/g, ''),
          source: isSnap ? 'snap' : 'desktop',
          packageName: file.replace(/\.desktop$/, ''),
        });
      } catch { /* unreadable file */ }
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

export async function installedPackagesSummary(): Promise<{
  apt: { total: number };
  snaps: { name: string; version: string }[];
  pnpmGlobals: { name: string; version: string }[];
  bunGlobals: { name: string; version: string }[];
}> {
  const [aptRes, snapRes, pnpmRes, bunRes] = await Promise.all([
    hostExec("dpkg-query -f='${binary:Package}\n' -W 2>/dev/null | wc -l", { user: 'root', timeoutMs: 30_000 }),
    hostExec('snap list 2>/dev/null | tail -n +2', { user: 'root', timeoutMs: 15_000 }),
    hostExec('pnpm ls -g --depth=0 --json 2>/dev/null || echo "[]"', { user: 'user', timeoutMs: 30_000 }),
    hostExec('bun pm ls -g 2>/dev/null', { user: 'user', timeoutMs: 30_000 }),
  ]);
  const snaps = snapRes.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const p = l.split(/\s+/);
      return { name: p[0], version: p[1] || '' };
    });
  let pnpmGlobals: { name: string; version: string }[] = [];
  const seenGlobal = new Set<string>();
  const pushGlobal = (name: string, version: string) => {
    if (!name || seenGlobal.has(name)) return;
    seenGlobal.add(name);
    pnpmGlobals.push({ name, version });
  };
  try {
    // `pnpm ls -g --depth=0 --json` → [{ path, private, dependencies: { name: {version,...} } }]
    // but the dep dict can also appear under `unsavedDependencies` or nested
    // inside other objects, so walk the whole structure.
    const ls = JSON.parse(pnpmRes.stdout);
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (
          (key === 'dependencies' || key === 'unsavedDependencies') &&
          value && typeof value === 'object' && !Array.isArray(value)
        ) {
          for (const [name, info] of Object.entries(value as Record<string, unknown>)) {
            const version = info && typeof info === 'object'
              ? String((info as Record<string, unknown>).version || '')
              : typeof info === 'string' ? info : '';
            pushGlobal(name, version);
          }
        } else if (value && typeof value === 'object') {
          visit(value);
        }
      }
    };
    visit(ls);
  } catch {
    // Fallback for non-JSON output: tree lines like `+ pkg@1.2.3` / `- pkg 1.2.3`.
    for (const line of pnpmRes.stdout.split('\n')) {
      const m = line.match(/^\s*(?:[+\-`│├└]*\s*)?(\S+)\s*$/);
      const token = m?.[1];
      if (!token || token.endsWith(':') || token === 'Legend:') continue;
      const at = token.lastIndexOf('@');
      if (at > 0) pushGlobal(token.slice(0, at), token.slice(at + 1));
      else pushGlobal(token, '');
    }
  }
  const bunGlobals: { name: string; version: string }[] = [];
  // `bun pm ls -g` prints tree lines like `├── pkg@1.2.3` / `└── pkg@1.2.3`
  for (const line of bunRes.stdout.split('\n')) {
    const m = line.match(/[├└]──\s+(\S+)/);
    if (!m) continue;
    const token = m[1];
    const at = token.lastIndexOf('@');
    if (at > 0) bunGlobals.push({ name: token.slice(0, at), version: token.slice(at + 1) });
    else bunGlobals.push({ name: token, version: '' });
  }
  return {
    apt: { total: parseInt(aptRes.stdout.trim(), 10) || 0 },
    snaps,
    pnpmGlobals,
    bunGlobals,
  };
}

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
const ICON_EXTS = ['.png', '.svg', '.xpm'];
const ICON_DIRS = [
  '/usr/share/pixmaps',
  '/usr/share/icons/hicolor/48x48/apps',
  '/usr/share/icons/hicolor/scalable/apps',
  '/usr/share/icons/hicolor/64x64/apps',
  '/usr/share/icons/hicolor/128x128/apps',
  '/usr/share/icons/hicolor/256x256/apps',
  '/usr/share/icons/hicolor/32x32/apps',
  '/var/lib/snapd/desktop/icons',
  '/snap/icons',
];

export async function resolveIcon(iconName: string): Promise<string | null> {
  if (!iconName || iconName.includes('..') || iconName.includes('\0')) return null;
  // Absolute path (desktop entries may store one) — only serve real image
  // files so the endpoint can't read arbitrary host files.
  if (iconName.startsWith('/')) {
    if (!/\.(png|svg|xpm|ico|jpe?g|webp)$/i.test(iconName)) return null;
    const p = hostToContainerFs(iconName);
    if (p) return p;
  }
  for (const dir of ICON_DIRS) {
    for (const ext of ICON_EXTS) {
      const candidate = `${dir}/${iconName}${ext}`;
      const p = hostToContainerFs(candidate);
      if (p) return p;
    }
  }
  return null;
}

function hostToContainerFs(hostPath: string): string | null {
  const p = `${HOST_FS}${hostPath}`;
  try {
    const { existsSync } = require('fs');
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}
