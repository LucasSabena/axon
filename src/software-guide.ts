// Plain-language guidance for the Programas page: an automatic folder for
// every installation and, for system pieces, what an update touches and how
// risky it is. Pure functions over inventory rows; no host access.

export type Risk = 'safe'|'review'|'careful';
export interface SoftwareRisk {level:Risk; group:string; title:string; detail:string}
interface Row {manager:string; kind:string; packageName:string; name:string; sourceName?:string; categories?:string[]; applicationId?:string; executables?:string[]}

export const FOLDERS=['IA y agentes','Internet y comunicación','Oficina','Multimedia','Gráficos y diseño','Desarrollo','Juegos','Educación y ciencia','Utilidades','Sistema y configuración','Herramientas de terminal','Componentes del sistema','Otros'] as const;
export type Folder=typeof FOLDERS[number];

const AI=/(?:^|[^a-z])(?:chatgpt|claude|codex|gemini|opencode|devin|cursor|ollama|lm-?studio|aider|copilot|ai-sdk|openai|anthropic)(?:[^a-z]|$)/i;
// First matching freedesktop category wins, so specific ones go first.
const BY_CATEGORY:[string[],Folder][]=[
  [['Game'],'Juegos'],
  [['Development','IDE','Debugger','RevisionControl'],'Desarrollo'],
  [['Graphics','3DGraphics','2DGraphics','Photography','RasterGraphics','VectorGraphics'],'Gráficos y diseño'],
  [['AudioVideo','Audio','Video','Player','Recorder'],'Multimedia'],
  [['Network','WebBrowser','Email','Chat','InstantMessaging','RemoteAccess','FileTransfer'],'Internet y comunicación'],
  [['Office','WordProcessor','Spreadsheet','Presentation'],'Oficina'],
  [['Education','Science'],'Educación y ciencia'],
  [['System','Settings','Monitor','TerminalEmulator','HardwareSettings','PackageManager'],'Sistema y configuración'],
  [['Utility','Accessibility','TextEditor','Archiving','Calculator'],'Utilidades'],
];
const DEV_MANAGERS=['pnpm','bun','cargo','pipx','uv','rustup','mise','node-global','nix','brew'];

export function softwareFolder(row:Row):Folder {
  const names=[row.name,row.packageName,row.applicationId||'',...(row.executables||[])].join(' ');
  if(AI.test(names))return 'IA y agentes';
  const categories=row.categories||[];
  for(const [keys,folder] of BY_CATEGORY)if(categories.some(c=>keys.includes(c)))return folder;
  if(row.kind==='runtime'||row.kind==='dependency')return 'Componentes del sistema';
  if(DEV_MANAGERS.includes(row.manager)||row.kind==='toolchain')return 'Desarrollo';
  if(row.kind==='tool')return 'Herramientas de terminal';
  if(row.manager==='snap'&&/^(?:core\d*|bare|snapd|gnome-\d|gtk-common-themes|mesa-)/.test(row.packageName))return 'Componentes del sistema';
  if(row.kind==='package'&&row.manager==='apt')return 'Componentes del sistema';
  return 'Otros';
}

interface Rule {test:RegExp; level:Risk; group:string; title:string; detail:string}
const RULES:Rule[]=[
  {test:/^linux-(?:image|headers|modules|generic|firmware|signed|tools)/,level:'careful',group:'kernel',title:'Núcleo de Linux (kernel)',detail:'Es el corazón del sistema. El cambio se aplica recién al reiniciar el servidor. Si algo fallara, en el menú de arranque se puede elegir el núcleo anterior. Conviene hacerlo cuando puedas reiniciar y estar cerca.'},
  {test:/^(?:nvidia-|libnvidia-|libxnvctrl|xserver-xorg-video-nvidia)/,level:'careful',group:'nvidia',title:'Driver de la placa de video NVIDIA',detail:'Controla la placa de video. Hasta reiniciar puede quedar sin aceleración gráfica, y si la versión nueva no se lleva bien con el núcleo, la pantalla o los programas que usan la GPU pueden dejar de andar.'},
  {test:/^(?:docker|containerd|runc)/,level:'careful',group:'docker',title:'Docker',detail:'Al actualizarse reinicia todos los contenedores, AXON incluido: esta página se va a cortar unos minutos y vuelve sola.'},
  {test:/^openssh-/,level:'careful',group:'ssh',title:'Acceso por SSH',detail:'Es la puerta de entrada remota por terminal. Las actualizaciones de Ubuntu suelen ser seguras, pero si fallara podrías perder el acceso remoto hasta arreglarlo en persona.'},
  {test:/^(?:systemd|libsystemd|udev|libudev|libc6|libc-bin|libssl|openssl|grub|shim|initramfs-tools|dbus|libpam-modules|libpam-runtime|login|passwd|sudo)/,level:'careful',group:'base',title:'Base del sistema',detail:'Piezas centrales de Ubuntu (arranque, usuarios, seguridad). Suelen ser correcciones de seguridad y salen bien, pero conviene hacerlas cuando puedas reiniciar si hace falta.'},
  {test:/^(?:gnome-shell|mutter|libmutter|gdm3|gnome-session|xwayland|gnome-settings-daemon)/,level:'review',group:'gnome',title:'Escritorio GNOME',detail:'Es la interfaz gráfica del escritorio. Si lo estás usando puede pedir cerrar sesión para aplicarse. No afecta a los servicios ni a AXON.'},
  {test:/^(?:sssd|libsss|libnss-sss|libpam-sss|python3-sss|libipa-hbac)/,level:'review',group:'sssd',title:'Inicio de sesión de red (SSSD)',detail:'Valida usuarios contra servidores de cuentas de empresa. En un servidor casero casi no se usa. Es una corrección menor de Ubuntu; muy raramente podría complicar el inicio de sesión.'},
  {test:/^snapd$/,level:'review',group:'snapd',title:'Motor de Snap',detail:'Es el servicio que hace funcionar las apps Snap (Firefox, por ejemplo). Se reinicia solo; las apps Snap abiertas pueden cerrarse un momento.'},
  {test:/^(?:xrdp|chrome-remote-desktop|tailscale|cloudflared|xorgxrdp)/,level:'review',group:'remote',title:'Acceso remoto',detail:'Programas que te dejan entrar al servidor desde afuera. Al actualizar se reinician: si estás conectado por ahí, la conexión se corta unos segundos y vuelve.'},
  {test:/^(?:network-manager|libnm|netplan|dnsmasq|systemd-resolved|wpasupplicant|iptables|nftables|ufw)/,level:'review',group:'network',title:'Red',detail:'Manejan la conexión de red y el DNS. Puede haber un corte de red de unos segundos mientras se reinician.'},
  {test:/^(?:apt|dpkg|libapt|flatpak|libflatpak)$/,level:'review',group:'packaging',title:'Gestor de paquetes',detail:'Es la herramienta que instala y actualiza programas. Actualizarla es normal; conviene no hacer otras instalaciones al mismo tiempo.'},
  {test:/^(?:wireplumber|libwireplumber|pipewire|libpipewire|pulseaudio|libpulse|alsa-)/,level:'safe',group:'audio',title:'Sonido',detail:'Manejan el audio del escritorio. Como mucho se reinicia el sonido.'},
  {test:/^(?:orca|at-spi|libatk|speech-dispatcher)/,level:'safe',group:'a11y',title:'Accesibilidad (lector de pantalla)',detail:'Herramientas de accesibilidad del escritorio. Seguro de actualizar.'},
  {test:/^(?:ubuntu-release-upgrader|python3-distupgrade|update-manager|update-notifier)/,level:'safe',group:'upgrader',title:'Asistente de nuevas versiones de Ubuntu',detail:'Sólo actualiza el asistente que avisa cuando sale una versión nueva de Ubuntu. No cambia tu versión de Ubuntu.'},
  {test:/^open-vm-tools/,level:'safe',group:'vmtools',title:'Herramientas para máquinas virtuales',detail:'Ayudan cuando Ubuntu corre dentro de VMware. Seguro de actualizar.'},
];

// Known system pieces keep their risk even when a desktop entry made them look
// like an app (GNOME "Extensions", "Snapd User Session Agent"…).
export function softwareRisk(row:Row):SoftwareRisk|undefined {
  const base=row.packageName.split(':')[0], source=row.sourceName||base;
  if(['apt','dnf','pacman','snap'].includes(row.manager))for(const rule of RULES)if(rule.test.test(base)||rule.test.test(source))return {level:rule.level,group:rule.group,title:rule.title,detail:rule.detail};
  if(['application','tool','toolchain'].includes(row.kind))return undefined;
  if(row.manager==='flatpak')return {level:'safe',group:'flatpak-runtime',title:'Componentes compartidos de Flatpak',detail:'Bibliotecas que usan las apps Flatpak (Blender, Godot y otras). Se actualizan sin tocar tus archivos; es seguro.'};
  if(row.manager==='snap')return {level:'safe',group:'snap-base',title:'Componentes compartidos de Snap',detail:'Bases que usan las apps Snap. Snap las actualiza solo de todos modos; es seguro.'};
  if(row.manager==='apt'&&row.kind==='package')return {level:'safe',group:'apt-app:'+source,title:row.name===base?base:row.name,detail:'Programa instalado con los paquetes de Ubuntu. Es seguro; si está abierto, puede pedir reiniciarlo.'};
  return {level:'safe',group:'lib:'+source,title:'Biblioteca del sistema · '+source,detail:'Pieza interna que usan otros programas. Este tipo de actualización de Ubuntu suele ser una corrección de seguridad y es segura de aplicar.'};
}
