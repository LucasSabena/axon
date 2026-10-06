export const SECTIONS = {
  dashboard: ['/', 'Inicio'], ports: ['/puertos', 'Puertos'], projects: ['/proyectos', 'Proyectos'],
  docker: ['/docker', 'Docker'], domains: ['/dominios', 'Dominios'], files: ['/archivos', 'Archivos'],
  library: ['/biblioteca', 'Biblioteca'], terminal: ['/terminal', 'Terminal'], navegador: ['/navegador', 'Navegador'],
  programs: ['/programas', 'Programas'], store: ['/tienda', 'Tienda'], drop: ['/drop', 'Drop'], metrics: ['/metricas', 'Métricas'],
  logs: ['/logs', 'Logs'], ops: ['/salud', 'Salud'], scripts: ['/scripts', 'Scripts'],
  storage: ['/almacenamiento', 'Almacenamiento'], compose: ['/compose', 'Compose'], agents: ['/agentes', 'Agentes'], settings: ['/configuracion', 'Configuración'],
  backups: ['/backups', 'Backups'], audit: ['/historial', 'Historial'], access: ['/integraciones', 'Integraciones'], desktop: ['/escritorio', 'Escritorio'],
};

export function readRoute(input, base = 'http://axon.local') {
  let u;try { u = new URL(input, base); } catch { return null; }
  const pathname = u.pathname.replace(/\/$/, '') || '/';
  const section = pathname === '/respaldos' ? 'backups' : Object.keys(SECTIONS).find((s) => SECTIONS[s][0] === pathname);
  if (!section) return null;
  return { section, params: Object.fromEntries(u.searchParams), url: pathname + u.search };
}

export function routeUrl(section, params = {}) {
  if (!SECTIONS[section]) throw new Error('Sección desconocida');
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value));
  }
  return SECTIONS[section][0] + (q.size ? '?' + q : '');
}

export function readStored(value, fallback = {}) {
  try { const data = JSON.parse(value); return data && typeof data === 'object' && !Array.isArray(data) ? data : fallback; }
  catch { return fallback; }
}
