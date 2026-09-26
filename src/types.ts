export interface ProcessStats {
  cpuPercent: number;
  memoryMb: number;
  uptimeSeconds: number;
  threads: number;
}

export interface Listener {
  proto: 'tcp' | 'udp';
  address: string;
  port: number;
  healthy?: boolean | null;
}

export type IdentityCategory = 'project' | 'service' | 'docker' | 'system' | 'unknown';

export interface Identity {
  category: IdentityCategory;
  label: string;
  icon: string;
  framework?: string;
  projectRoot?: string;
  packageName?: string;
  serviceKey?: string;
  unit?: string;
  unitScope?: 'user' | 'system';
  protected: boolean;
  protectionReason?: string;
}

export interface PortProcess {
  pid: number;
  ppid: number;
  user: string;
  uid: number;
  name: string;
  cmd: string;
  cwd: string;
  listeners: Listener[];
  ports: number[];
  identity: Identity;
  memoryMb: number;
  uptimeSeconds: number;
  startedAt: string;
}

export interface KillPlan {
  pid: number;
  name: string;
  cmd: string;
  cwd: string;
  identity: Identity;
  portsFreed: number[];
  tree: { pid: number; name: string; cmd: string }[];
  warnings: string[];
  blocked?: string;
}

export interface ProcessDetails {
  pid: number;
  ppid: number;
  name: string;
  cmd: string;
  cwd: string;
  user: string;
  ports: number[];
  identity: Identity;
  env: Record<string, string>;
  stats: ProcessStats;
  startedAt: string;
  logSources: LogSource[];
}

export interface LogSource {
  type: 'file' | 'journal' | 'docker-logs' | 'job';
  label: string;
  path?: string;
  unit?: string;
}

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  publicPorts: number[];
  projectName: string;
  composeProject?: string;
  domain?: DomainMapping;
}

export interface DomainMapping {
  id: string;
  subdomain: string;
  fullDomain: string;
  target: string;
  port: number;
  projectName: string;
  processType: 'process' | 'docker';
  createdAt: string;
  dnsRecordId?: string;
}

export interface DomainStatus {
  state: 'up' | 'warn' | 'down';
  httpStatus?: number;
  reason?: string;
}

export interface Project {
  id: string;
  name: string;
  cwd: string; // host path
  command?: string;
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  type: 'node' | 'bun' | 'python' | 'rust' | 'go' | 'static' | 'other';
  framework?: string;
  port?: number;
  autoDetect: boolean;
  running?: { pid: number; ports: number[]; startedAt: string };
}

export interface ProgramStep {
  label: string;
  cmd: string;
  user: 'root' | 'user';
}

export interface ProgramDef {
  id: string;
  name: string;
  icon: string;
  desc?: string;
  channel: 'apt' | 'snap' | 'pnpm' | 'bun' | 'uv' | 'pipx' | 'cargo' | 'script';
  npmPkg?: string; // npm package name — enables `npm view` latest-version check
  detect: { cmd: string; user: 'root' | 'user' }[];
  version?: { cmd: string; user: 'root' | 'user' };
  updatesCheck?: { cmd: string; user: 'root' | 'user' };
  steps: ProgramStep[];
}

export interface ProgramView {
  id: string;
  name: string;
  icon: string;
  brandIcon?: string;
  desc?: string;
  channel: ProgramDef['channel'];
  installed: boolean;
  version?: string;
  latestVersion?: string;
  pendingUpdates?: string;
  steps: { label: string; cmd: string; user: string }[];
}

export interface DesktopApp {
  name: string;
  icon?: string;
  exec?: string;
  source: 'desktop' | 'snap' | 'pnpm' | 'bun';
  packageName?: string;
  version?: string;
}

export interface JobStepState {
  label: string;
  status: 'pending' | 'running' | 'ok' | 'failed' | 'skipped';
  exitCode?: number;
  hint?: string;
  group?: string;
}

export interface Job {
  id: string;
  title: string;
  status: 'running' | 'ok' | 'failed';
  steps: JobStepState[];
  log: string;
  startedAt: string;
  endedAt?: string;
}

export interface KnownService {
  name: string;
  icon: string;
}

export interface AppConfig {
  auth: {
    username: string;
    passwordHash: string;
  };
  domains: DomainMapping[];
  projects?: Project[];
  settings: {
    scanIntervalMs: number;
    protectedPids: number[];
    protectedPorts: number[];
    ignoredPatterns: string[];
    scanDirs: string[];
    hostUser: string;
    knownServices: Record<string, KnownService>;
  };
}

export interface ApiError {
  ok: false;
  error: string;
  detail?: string;
  command?: string;
  exitCode?: number;
}
