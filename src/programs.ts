import { readdir } from 'fs/promises';
import * as path from 'path';
import { HOST_FS, hostExec, readHostFile } from './host';
import type { DesktopApp, ProgramDef, ProgramView } from './types';

// Registry of updatable programs. Each step declares which user runs it on the
// host: root for system package managers, `user` for user-level tools whose
// binaries live in ~/.local, ~/.bun, etc.
const PROGRAMS: ProgramDef[] = [
  {
    id: 'openai-suite',
    name: 'OpenAI (Codex CLI + ChatGPT desktop)',
    icon: 'bot',
    desc: 'Actualiza el CLI de Codex (pnpm global) y la app de escritorio ChatGPT (apt) a la vez.',
    channel: 'script',
    detect: [
      { cmd: 'command -v codex', user: 'user' },
    ],
    version: { cmd: 'codex --version 2>/dev/null | head -1', user: 'user' },
    steps: [
      { label: 'Codex CLI', cmd: 'pnpm update -g @openai/codex || pnpm add -g @openai/codex', user: 'user' },
      { label: 'ChatGPT desktop', cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y chatgpt', user: 'root' },
    ],
  },
  {
    id: 'apt',
    name: 'Sistema (APT)',
    icon: 'package',
    desc: 'Todos los paquetes .deb del sistema operativo.',
    channel: 'apt',
    detect: [{ cmd: 'command -v apt-get', user: 'root' }],
    updatesCheck: { cmd: "apt list --upgradable 2>/dev/null | tail -n +2 | wc -l", user: 'root' },
    steps: [
      { label: 'apt update', cmd: 'apt-get update', user: 'root' },
      { label: 'apt upgrade', cmd: 'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y', user: 'root' },
    ],
  },
  {
    id: 'snap',
    name: 'Snap packages',
    icon: 'package',
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
    detect: [{ cmd: 'command -v docker', user: 'root' }],
    version: { cmd: 'docker --version', user: 'root' },
    steps: [{
      label: 'apt upgrade docker',
      cmd: 'apt-get update -qq 2>/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install --only-upgrade -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
      user: 'root',
    }],
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
    icon: 'code',
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
  {
    id: 'pnpm-globals',
    name: 'Herramientas globales pnpm',
    icon: 'wrench',
    desc: 'Todas las CLIs instaladas con pnpm add -g.',
    channel: 'pnpm',
    detect: [{ cmd: 'command -v pnpm', user: 'user' }],
    version: { cmd: 'pnpm --version', user: 'user' },
    steps: [
      { label: 'Actualizar pnpm', cmd: 'pnpm self-update 2>/dev/null || pnpm add -g pnpm', user: 'user' },
      { label: 'pnpm update -g', cmd: 'pnpm update -g --latest', user: 'user' },
    ],
  },
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
    icon: 'circle-dot',
    channel: 'bun',
    detect: [{ cmd: 'command -v bun', user: 'user' }],
    version: { cmd: 'bun --version', user: 'user' },
    steps: [{ label: 'bun upgrade', cmd: 'bun upgrade', user: 'user' }],
  },
  {
    id: 'uv',
    name: 'uv (Python)',
    icon: 'terminal',
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
    icon: 'terminal',
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
    icon: 'cog',
    channel: 'cargo',
    detect: [{ cmd: 'command -v cargo-install-update', user: 'user' }],
    steps: [{ label: 'cargo install-update', cmd: 'cargo install-update -a', user: 'user' }],
  },
];

export function programById(id: string): ProgramDef | undefined {
  return PROGRAMS.find((p) => p.id === id);
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
}> {
  const [aptRes, snapRes, pnpmRes] = await Promise.all([
    hostExec("dpkg-query -f='${binary:Package}\n' -W 2>/dev/null | wc -l", { user: 'root', timeoutMs: 30_000 }),
    hostExec('snap list 2>/dev/null | tail -n +2', { user: 'root', timeoutMs: 15_000 }),
    hostExec('pnpm ls -g --depth=0 --json 2>/dev/null || echo "[]"', { user: 'user', timeoutMs: 30_000 }),
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
  return {
    apt: { total: parseInt(aptRes.stdout.trim(), 10) || 0 },
    snaps,
    pnpmGlobals,
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
  if (!iconName || iconName.includes('..')) return null;
  // Absolute path already
  if (iconName.startsWith('/')) {
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
