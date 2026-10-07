import { readFile, chmod } from 'fs/promises';
import { atomicPrivateWrite } from './atomic-file';
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
    // Holds passwordHash/totpSecret — fix the mode if an older release or a
    // manual edit left it group/world-readable.
    await chmod(CONFIG_PATH, 0o600).catch(() => {});
  } catch (error) {
    // Only a missing file is a fresh install. Corrupt JSON, inaccessible data,
    // and invalid credentials must never replace the administrator's state.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`No se pudo cargar la configuración en ${CONFIG_PATH}`, { cause: error });
    const initialPassword = crypto.randomUUID() + crypto.randomUUID();
    config = {
      auth: { username: 'admin', passwordHash: await hashPassword(initialPassword) },
      domains: [],
    } as AppConfig;
    console.log(`[axon] No config found at ${CONFIG_PATH} — generated one-time admin password: ${initialPassword}`);
    config.settings = { ...DEFAULT_SETTINGS };
    await saveConfig(config);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      !config.auth || typeof config.auth.username !== 'string' || !config.auth.username ||
      typeof config.auth.passwordHash !== 'string' || !/^[^:]+:[A-Za-z0-9+/]{43}=$/.test(config.auth.passwordHash) ||
      (config.settings != null && (typeof config.settings !== 'object' || Array.isArray(config.settings))) ||
      (config.domains != null && !Array.isArray(config.domains)) ||
      (config.projects != null && !Array.isArray(config.projects))) {
    throw new Error(`Configuración inválida en ${CONFIG_PATH}; conservá el archivo y recuperá una copia válida.`);
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
    await atomicPrivateWrite(CONFIG_PATH, text);
  });
  saveQueue = operation;
  return operation;
}
