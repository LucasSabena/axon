// Reglas declarativas de Salud (mismo enfoque que BleachBit: cada limpiador es
// una regla con "medir", "limpiar" y condiciones de seguridad) y funciones puras
// para procesos y crecimiento del disco. Sin efectos: las ejecuta health.ts.

export type Risk = 'safe' | 'regen' | 'review';

export interface Rule {
  id: string;
  group: 'temporales' | 'sistema' | 'paquetes' | 'apps' | 'papelera' | 'docker' | 'bases';
  label: string;
  desc: string;
  risk: Risk;
  as: 'user' | 'root';
  /** Imprime un entero de bytes. Sin esto el tamaño no se puede estimar. */
  measure?: string;
  /** Bytes que se conservan aunque se limpie (p. ej. el tope del journal). */
  keep?: number;
  clean: string;
  /** Si este comando termina en 0, el recurso está en uso y se omite. */
  busy?: string;
}

export const GROUPS: Record<Rule['group'], string> = {
  temporales: 'Archivos temporales',
  sistema: 'Sistema y registros',
  paquetes: 'Cachés de paquetes',
  apps: 'Cachés de aplicaciones',
  papelera: 'Papeleras',
  docker: 'Docker',
  bases: 'Bases de datos',
};

export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const sumDu = (paths: string) => `du -sx -B1 ${paths} 2>/dev/null | awk '{s+=$1} END{print s+0}'`;
const findSum = (find: string) => `${find} -print0 2>/dev/null | xargs -0 -r du -sx -B1 2>/dev/null | awk '{s+=$1} END{print s+0}'`;
const findRm = (find: string) => `${find} -print0 2>/dev/null | xargs -0 -r rm -rf --`;

export function staticRules(home: string, user: string): Rule[] {
  const h = (p: string) => q(`${home}/${p}`);
  const tmpFind = `find /tmp -mindepth 1 -maxdepth 1 -user ${q(user)} -mtime +2 ! -name '.*' ! -name 'systemd-private-*' ! -name 'snap-private-tmp' ! -name 'tmux-*' ! -name 'ssh-*' ! -name 'claude-*'`;
  const claudeFind = `find /tmp -mindepth 2 -maxdepth 2 -path '/tmp/claude-*' -mtime +2`;
  const varTmp = `find /var/tmp -mindepth 1 -maxdepth 1 -mtime +7`;
  const oldLogs = `find /var/log -type f \\( -name '*.gz' -o -name '*.[0-9]' -o -name '*.old' -o -name '*.xz' \\) -mtime +7`;
  const crash = `find /var/crash /var/lib/systemd/coredump -mindepth 1 -maxdepth 1 -type f`;
  return [
    { id: 'tmp-user', group: 'temporales', label: 'Temporales de /tmp', desc: 'Archivos y carpetas tuyos en /tmp sin tocar hace más de 2 días.', risk: 'safe', as: 'user', measure: findSum(tmpFind), clean: findRm(tmpFind) },
    { id: 'tmp-claude', group: 'temporales', label: 'Borradores de agentes', desc: 'Carpetas de trabajo de sesiones de Claude en /tmp con más de 2 días.', risk: 'safe', as: 'user', measure: findSum(claudeFind), clean: findRm(claudeFind) },
    { id: 'var-tmp', group: 'temporales', label: 'Temporales de /var/tmp', desc: 'Archivos del sistema en /var/tmp con más de 7 días.', risk: 'safe', as: 'root', measure: findSum(varTmp), clean: findRm(varTmp) },
    { id: 'journal', group: 'sistema', label: 'Registro del sistema (journal)', desc: 'Conserva sólo los últimos 200 MB de mensajes del sistema.', risk: 'safe', as: 'root', measure: sumDu('/var/log/journal'), keep: 200 * 1024 * 1024, clean: 'journalctl --vacuum-size=200M' },
    { id: 'logs-old', group: 'sistema', label: 'Logs rotados viejos', desc: 'Copias comprimidas de logs con más de 7 días en /var/log.', risk: 'safe', as: 'root', measure: findSum(oldLogs), clean: findRm(oldLogs) },
    { id: 'crash', group: 'sistema', label: 'Reportes de errores', desc: 'Volcados de errores de programas (/var/crash y coredumps).', risk: 'safe', as: 'root', measure: findSum(crash), clean: findRm(crash) },
    { id: 'apt', group: 'sistema', label: 'Descargas de APT', desc: 'Paquetes .deb ya instalados que quedan en /var/cache/apt.', risk: 'safe', as: 'root', measure: sumDu('/var/cache/apt/archives'), clean: 'apt-get clean', busy: 'pgrep -x apt-get >/dev/null || pgrep -x apt >/dev/null || pgrep -x dpkg >/dev/null' },
    { id: 'npm', group: 'paquetes', label: 'Caché de npm / npx', desc: 'Paquetes descargados por npm y npx. Se vuelven a bajar al usarlos.', risk: 'regen', as: 'user', measure: sumDu(`${h('.npm/_cacache')} ${h('.npm/_npx')} ${h('.npm/_logs')}`), clean: `rm -rf ${h('.npm/_cacache')} ${h('.npm/_npx')} ${h('.npm/_logs')}`, busy: 'pgrep -x npm >/dev/null || pgrep -x npx >/dev/null' },
    { id: 'pnpm-meta', group: 'paquetes', label: 'Caché de pnpm', desc: 'Metadatos descargados por pnpm.', risk: 'regen', as: 'user', measure: sumDu(h('.cache/pnpm')), clean: `rm -rf ${h('.cache/pnpm')}`, busy: 'pgrep -x pnpm >/dev/null' },
    { id: 'pnpm-store', group: 'paquetes', label: 'Almacén de pnpm (sin uso)', desc: 'Quita del almacén de pnpm los paquetes que ningún proyecto usa. El tamaño se ve después de limpiar.', risk: 'regen', as: 'user', clean: 'pnpm store prune', busy: 'pgrep -x pnpm >/dev/null' },
    { id: 'uv', group: 'paquetes', label: 'Caché de uv (Python)', desc: 'Paquetes Python descargados por uv.', risk: 'regen', as: 'user', measure: sumDu(h('.cache/uv')), clean: 'uv cache clean', busy: 'pgrep -x uv >/dev/null' },
    { id: 'pip', group: 'paquetes', label: 'Caché de pip', desc: 'Paquetes Python descargados por pip.', risk: 'regen', as: 'user', measure: sumDu(h('.cache/pip')), clean: `rm -rf ${h('.cache/pip')}`, busy: 'pgrep -x pip >/dev/null || pgrep -x pip3 >/dev/null' },
    { id: 'bun', group: 'paquetes', label: 'Caché de bun', desc: 'Paquetes descargados por bun.', risk: 'regen', as: 'user', measure: sumDu(h('.bun/install/cache')), clean: `rm -rf ${h('.bun/install/cache')}`, busy: 'pgrep -f "bun (install|add)" >/dev/null' },
    { id: 'cargo', group: 'paquetes', label: 'Caché de Rust (cargo)', desc: 'Código fuente y paquetes de crates descargados.', risk: 'regen', as: 'user', measure: sumDu(`${h('.cargo/registry/cache')} ${h('.cargo/registry/src')} ${h('.cache/cargo-xwin')}`), clean: `rm -rf ${h('.cargo/registry/cache')} ${h('.cargo/registry/src')} ${h('.cache/cargo-xwin')}`, busy: 'pgrep -x cargo >/dev/null || pgrep -x rustc >/dev/null' },
    { id: 'go', group: 'paquetes', label: 'Caché de compilación de Go', desc: 'Resultados de compilación de Go.', risk: 'regen', as: 'user', measure: sumDu(h('.cache/go-build')), clean: `rm -rf ${h('.cache/go-build')}`, busy: 'pgrep -x go >/dev/null' },
    { id: 'thumbs', group: 'apps', label: 'Miniaturas', desc: 'Vistas previas de imágenes generadas por el escritorio.', risk: 'regen', as: 'user', measure: sumDu(h('.cache/thumbnails')), clean: `rm -rf ${h('.cache/thumbnails')}` },
    { id: 'trash-xdg', group: 'papelera', label: 'Papelera del escritorio', desc: 'Lo que borraste desde el escritorio. Se elimina para siempre.', risk: 'review', as: 'user', measure: sumDu(`${h('.local/share/Trash/files')} ${h('.local/share/Trash/expunged')}`), clean: `rm -rf ${h('.local/share/Trash/files')}/* ${h('.local/share/Trash/files')}/.[!.]* ${h('.local/share/Trash/info')}/* ${h('.local/share/Trash/expunged')}/* 2>/dev/null; true` },
    { id: 'trash-axon', group: 'papelera', label: 'Papelera de AXON', desc: 'Lo que borraste desde Archivos. Se elimina para siempre.', risk: 'review', as: 'user', measure: sumDu(h('.local/share/axon-trash')), clean: `rm -rf ${h('.local/share/axon-trash')}/* ${h('.local/share/axon-trash')}/.[!.]* 2>/dev/null; true` },
  ];
}

/** Carpetas de datos de navegadores/editores donde sólo se borran cachés. */
export const BROWSER_ROOTS = ['.config/google-chrome', '.config/navegador-chrome', '.config/chromium', '.config/Code'];

export function browserRule(home: string, root: string, bytes: number): Rule {
  const abs = `${home}/${root}`;
  const find = `find ${q(abs)} -maxdepth 4 -type d \\( -name Cache -o -name 'Code Cache' -o -name GPUCache -o -name CacheStorage -o -name 'Cache_Data' \\) -prune`;
  const name = root.split('/').pop() || root;
  const busy = name === 'google-chrome'
    ? `pgrep -af '/opt/google/chrome/chrome' | grep -v 'user-data-dir' | grep -q .`
    : `pgrep -f ${q('user-data-dir=' + abs)} >/dev/null || pgrep -f ${q(abs)} >/dev/null`;
  return {
    id: `browser:${name}`, group: 'apps', label: `Caché de ${name}`, risk: 'regen', as: 'user',
    desc: 'Páginas e imágenes guardadas para cargar más rápido. No toca contraseñas, sesiones ni historial. Hay que cerrar el navegador.',
    measure: findSum(find), clean: findRm(find), busy,
  };
}

/** Subcarpetas de ~/.cache ya cubiertas por otra regla o que no conviene tocar. */
export const CACHE_HANDLED = new Set(['pnpm', 'uv', 'pip', 'go-build', 'thumbnails', 'cargo-xwin']);
export const CACHE_PROTECTED = /^(keyring|keyrings|dconf|gnome-keyring|ssh|gnupg)/i;
export const SAFE_NAME = /^[\w@+.][\w @+.-]{0,119}$/;

export function cacheRule(home: string, name: string, bytes: number): Rule | null {
  if (!SAFE_NAME.test(name) || name.includes('..') || CACHE_HANDLED.has(name) || CACHE_PROTECTED.test(name)) return null;
  const abs = `${home}/.cache/${name}`;
  return {
    id: `cache:${name}`, group: 'apps', label: name, risk: 'regen', as: 'user',
    desc: 'Caché de una aplicación. Se vuelve a generar o a descargar al usarla (modelos y datos pueden tardar).',
    measure: sumDu(q(abs)), clean: `rm -rf ${q(abs)}`,
    busy: /chrom|playwright|electron/i.test(name) ? 'pgrep -u "$(id -u)" -f "chrome|chromium|playwright|electron" >/dev/null' : `pgrep -f ${q(abs + '/')} >/dev/null`,
  };
}

export function walRule(file: string): Rule | null {
  if (!/^\/[\w@+./ -]+-wal$/.test(file) || file.includes('..')) return null;
  const db = file.slice(0, -4);
  return {
    id: `wal:${file}`, group: 'bases', label: db.split('/').pop() + ' (registro de escritura)', risk: 'safe', as: 'user',
    desc: `Compacta el archivo -wal de ${db}: pasa los cambios pendientes a la base y libera el espacio. No borra datos.`,
    measure: `stat -c %s ${q(file)} 2>/dev/null || echo 0`,
    clean: `sqlite3 ${q(db)} 'PRAGMA wal_checkpoint(TRUNCATE);'`,
  };
}

// ---------- Docker ----------

const UNITS: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3 };
export function parseSize(text: string): number {
  const m = /^\s*([\d.]+)\s*([A-Za-z]+)/.exec(text);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * (UNITS[m[2].toUpperCase()] ?? 1));
}

/** `docker system df --format '{{.Type}}|{{.Reclaimable}}'` → bytes por tipo. */
export function parseDockerDf(out: string): Record<string, number> {
  const res: Record<string, number> = {};
  for (const line of out.split('\n')) {
    const [type, rec] = line.split('|');
    if (type && rec) res[type.trim()] = parseSize(rec);
  }
  return res;
}

export const DOCKER_RULES: (Rule & { dfType: string })[] = [
  { id: 'docker-build', dfType: 'Build Cache', group: 'docker', label: 'Caché de compilación de Docker', desc: 'Capas intermedias de docker build. La próxima compilación puede tardar más.', risk: 'regen', as: 'root', clean: 'docker builder prune -af' },
  { id: 'docker-images', dfType: 'Images', group: 'docker', label: 'Imágenes sin usar', desc: 'Imágenes que ningún contenedor usa (incluidas las sin etiqueta). Se vuelven a bajar si hacen falta.', risk: 'review', as: 'root', clean: 'docker image prune -af' },
  { id: 'docker-containers', dfType: 'Containers', group: 'docker', label: 'Contenedores detenidos', desc: 'Contenedores apagados. Se pierde lo que tengan dentro que no esté en un volumen.', risk: 'review', as: 'root', clean: 'docker container prune -f' },
];

// ---------- Procesos ----------

export const PROTECTED_EXE = new Set([
  'systemd', 'init', 'sshd', 'dbus-daemon', 'dbus-broker', 'NetworkManager', 'cloudflared', 'dockerd', 'containerd',
  'containerd-shim-runc-v2', 'Xorg', 'Xwayland', 'gnome-shell', 'gdm', 'gdm3', 'login', 'polkitd', 'udisksd',
  'wpa_supplicant', 'chronyd', 'rsyslogd', 'cron', 'agetty', 'systemd-logind', 'systemd-journald', 'systemd-udevd',
  'systemd-resolved', 'systemd-oomd', 'pipewire', 'wireplumber', 'pulseaudio',
]);

export interface RawProc { pid: number; ppid: number; uid: number; user: string; nice: number; state: string; ticks: number; start: number; rss: number; threads: number; kernel: boolean; args: string }

const INTERPRETERS = new Set(['bun', 'node', 'python', 'python3', 'java', 'sh', 'bash', 'deno', 'ruby', 'perl']);
export const exeOf = (args: string) => (args.split(' ')[0] || '').split('/').pop() || args;

/** Nombre legible para agrupar: "bun src/index.ts", "Chrome navegador-chrome", etc. */
export function appLabel(args: string): string {
  const tokens = args.split(' ');
  const exe = exeOf(args);
  if (args.includes('/.claude/remote/ccd-cli/')) return 'Claude Code (sesión)';
  if (exe === 'chrome' || exe === 'google-chrome') {
    const dir = /user-data-dir=(\S+)/.exec(args)?.[1];
    return dir ? `Chrome (${dir.split('/').pop()})` : 'Chrome';
  }
  if (INTERPRETERS.has(exe)) {
    const script = tokens.slice(1).find(t => !t.startsWith('-') && t !== 'run' && t !== '-c');
    if (script) return `${exe} ${script.split('/').slice(-2).join('/')}`.slice(0, 60);
  }
  return exe.slice(0, 60);
}

export function isProtected(p: RawProc, hostUid: number, ancestors: Set<number>): string | null {
  if (p.kernel || p.pid <= 2 || p.ppid === 2) return 'Proceso del sistema';
  if (p.uid !== hostUid) return 'Pertenece a otro usuario o al sistema';
  if (ancestors.has(p.pid)) return 'Es parte de AXON';
  const exe = exeOf(p.args);
  if (PROTECTED_EXE.has(exe) || exe.startsWith('systemd')) return 'Es necesario para el sistema';
  if (/\/axon\b.*\bsrc\/index\.ts|\bdist\/index\.js/.test(p.args)) return 'Es parte de AXON';
  return null;
}

export interface NiceRule { id: string; label: string; needles: string[]; nice: number; enabled: boolean; custom?: boolean }

export const DEFAULT_NICE_RULES: NiceRule[] = [
  { id: 'encoders', label: 'Video y audio (ffmpeg, HandBrake, x265)', needles: ['ffmpeg', 'handbrakecli', 'x265', 'x264'], nice: 10, enabled: true },
  { id: 'compilers', label: 'Compiladores (cargo, rustc, gcc, tsc)', needles: ['rustc', 'cargo build', 'cc1plus', 'cc1 ', '/ld ', 'tsc '], nice: 10, enabled: true },
  { id: 'archivers', label: 'Compresión y copias (tar, zstd, rsync)', needles: ['zstd', 'rsync', ' xz ', 'gzip', '7z '], nice: 10, enabled: true },
  { id: 'whisper', label: 'Transcripción (whisper)', needles: ['whisper', 'transcribe_worker'], nice: 10, enabled: true },
  { id: 'indexers', label: 'Indexadores (du, find, tracker)', needles: ['tracker-miner', 'baloo', ' du -', 'plocate-build', 'updatedb'], nice: 15, enabled: true },
];

export function niceRuleFor(args: string, rules: NiceRule[]): NiceRule | null {
  const hay = ' ' + args.toLowerCase() + ' ';
  return rules.find(r => r.enabled && r.needles.some(n => n && hay.includes(n.toLowerCase()))) ?? null;
}

// ---------- Crecimiento del disco ----------

export type DirSnap = Record<string, number>;

/** Carpetas que más crecieron entre dos fotos; oculta el ancestro si un hijo explica casi todo. */
export function growthBetween(prev: DirSnap, next: DirSnap, minBytes = 100 * 1024 * 1024, limit = 12) {
  const deltas = Object.entries(next).map(([p, b]) => ({ path: p, delta: b - (prev[p] ?? 0), bytes: b })).filter(d => d.delta >= minBytes);
  const kept = deltas.filter(d => !deltas.some(c => c.path !== d.path && c.path.startsWith(d.path + '/') && c.delta >= d.delta * 0.7));
  return kept.sort((a, b) => b.delta - a.delta).slice(0, limit);
}
