import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import * as path from 'path';
import { hashPassword } from './auth';
import type { AppConfig } from './types';

const CONFIG_PATH = process.env.CONFIG_PATH || '/app/data/config.json';

const DEFAULT_SETTINGS: AppConfig['settings'] = {
  scanIntervalMs: 5000,
  protectedPids: [1],
  protectedPorts: [22, 80, 443, 3457, 9090, 9443],
  ignoredPatterns: [],
  scanDirs: [],
  hostUser: 'root',
  knownServices: {
    '4095': { name: 'OpenChamber', icon: 'brain' },
  },
};

export async function loadConfig(): Promise<AppConfig> {
  let config: AppConfig;
  try {
    const content = await readFile(CONFIG_PATH, 'utf-8');
    config = JSON.parse(content);
  } catch {
    config = {
      auth: { username: 'admin', passwordHash: await hashPassword('admin') },
      domains: [],
    } as AppConfig;
  }
  config.settings = { ...DEFAULT_SETTINGS, ...(config.settings || {}) };
  if (process.env.PROJECT_SCAN_DIRS) {
    config.settings.scanDirs = process.env.PROJECT_SCAN_DIRS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (process.env.HOST_USER) {
    config.settings.hostUser = process.env.HOST_USER;
  }
  config.settings.knownServices = {
    ...DEFAULT_SETTINGS.knownServices,
    ...(config.settings?.knownServices || {}),
  };
  config.domains = config.domains || [];
  // Migrate legacy project paths: the host home used to be mounted at /host, now /hostfs
  for (const p of config.projects || []) {
    if (p.cwd?.startsWith('/host/')) p.cwd = `/home/${config.settings.hostUser}/${p.cwd.slice(6)}`;
  }
  return config;
}

let saveQueue: Promise<void> = Promise.resolve();
export function saveConfig(config: AppConfig): Promise<void> {
  const text = JSON.stringify(config, null, 2);
  const operation = saveQueue.catch(() => {}).then(async () => {
    await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
    const temp = `${CONFIG_PATH}.${process.pid}.tmp`;
    await writeFile(temp, text, 'utf-8');
    await rename(temp, CONFIG_PATH);
  });
  saveQueue = operation;
  return operation;
}
