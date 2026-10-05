import { SECTIONS, readRoute, routeUrl, readStored } from './navigation-model.js';

const actors = new Map();
const saved = readStored(localStorage.getItem('axon:locations:v1'));
for (const key of Object.keys(saved)) { const route=readRoute(saved[key]?.url || ''); if(!route || route.section!==key) delete saved[key]; }

let current = null, internal = false, serial = 0, maxIndex = 0, ready = false;
let restoring = false, applying = false;
let domReady=document.readyState==='complete';
let historyMax={};try{historyMax=readStored(sessionStorage.getItem('axon:history:v1'));}catch{}
const pages = () => window.AxonPages || {};
const main = () => document.querySelector('main.content');
function closeDrawer(){
  const mobile=matchMedia('(max-width:768px)').matches;
  if(mobile && document.activeElement?.closest('.sidebar'))main()?.focus({preventScroll:true});
  document.body.classList.remove('sidebar-open');document.querySelector('#mobile-menu-btn')?.setAttribute('aria-expanded','false');
  const sidebar=document.querySelector('.sidebar');if(sidebar)sidebar.inert=mobile;
}
const writeSaved = () => { try { localStorage.setItem('axon:locations:v1', JSON.stringify(saved)); } catch { /* full or disabled storage */ } };
const fresh = (route, index = 0, view = null) => ({ ...route, v: 1, index, view, scroll: 0, chain: current?.chain || crypto.randomUUID() });

function decorate() {
  document.querySelectorAll('.sidebar-nav .tab-btn, #sidebar-settings').forEach((button) => {
    if (button.tagName === 'A') return;
    const section = button.dataset.tab || 'settings';
    if (!SECTIONS[section]) return;
    const link = document.createElement('a');
    for (const attr of button.attributes) link.setAttribute(attr.name, attr.value);
    link.dataset.tab = section;
    link.classList.add('tab-btn');
    link.href = saved[section]?.url || routeUrl(section);
    link.append(...button.childNodes);
    actors.set(section, button);
    button.replaceWith(link);
  });
}

function controls() {
  if(current?.chain && historyMax[current.chain]!==maxIndex){historyMax[current.chain]=maxIndex;try{sessionStorage.setItem('axon:history:v1',JSON.stringify(historyMax));}catch{}}
  document.querySelectorAll('[data-axon-back]').forEach((b) => { b.disabled = !current || current.index <= 0; });
  document.querySelectorAll('[data-axon-forward]').forEach((b) => { b.disabled = !current || current.index >= maxIndex; });
  document.querySelectorAll('.sidebar-nav .tab-btn').forEach((a) => {
    const on = a.dataset.tab === current?.section;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    a.href = saved[a.dataset.tab]?.url || routeUrl(a.dataset.tab);
  });
  if (current) document.title = `${SECTIONS[current.section][1]} · AXON`;
}

function remember() {
  if (!current) return;
  saved[current.section] = { url: current.url, view: current.view, scroll: current.scroll, t: Date.now() };
  writeSaved();
}

function checkpoint() {
  if (!ready || !current || restoring || applying) return;
  current.view = pages()[current.section]?.capture?.() ?? current.view;
  current.scroll = main()?.scrollTop || 0;
  history.replaceState({ ...(history.state || {}), axon: current }, '', current.url);
  remember();
  controls();
}

async function apply(state) {
  const ticket = ++serial;
  const old = current;
  applying = true;
  if (old?.section !== state.section) pages()[old?.section]?.leave?.();
  current = state;
  maxIndex = Math.max(maxIndex, state.index);
  internal = true;
  try { if (state.section !== 'settings') actors.get(state.section)?.click(); }
  finally { internal = false; }
  window.activateAxonSection?.(state.section, false);
  closeDrawer();
  if(old?.section!==state.section && main()){main().tabIndex=-1;main().focus({preventScroll:true});}
  controls();
  try {
    await pages()[state.section]?.restore?.(state.params, state.view);
    if (ticket !== serial) return;
    const params=pages()[state.section]?.params?.();
    if(params){ const route=readRoute(routeUrl(state.section,params),location.origin); Object.assign(state,route); history.replaceState({axon:state},'',state.url); }
    if (main()) main().scrollTop = state.scroll || 0;
    document.dispatchEvent(new CustomEvent('axon:route', { detail: state }));
  } catch (err) { window.console.error('No se pudo restaurar la ubicación', err); }
  finally { if (ticket === serial) { applying = false; checkpoint(); } }
}

async function go(input, { replace = false, remember: resume = false, view, transient = false } = {}) {
  let route = readRoute(input, location.origin);
  if (!route) return false;
  if (resume && !Object.keys(route.params).length && saved[route.section]) {
    route = readRoute(saved[route.section].url, location.origin) || route;
    view ??= saved[route.section]?.view;
  }
  if (await pages()[current?.section]?.canLeave?.(route) === false) return false;
  checkpoint();
  if (route.url === current?.url && view === undefined) {closeDrawer();return true;}
  const index = replace ? current?.index || 0 : (current?.index || 0) + 1;
  if (!replace) maxIndex = index;
  const state = fresh(route, index, view);
  state.transient = transient;
  history[replace ? 'replaceState' : 'pushState']({ axon: state }, '', route.url);
  await apply(state);
  return true;
}

// Update a preference/focus in place; moving to another location uses go().
function update(section, params, { push = false } = {}) {
  if (!ready || applying || current?.section !== section) return;
  checkpoint();
  const route = readRoute(routeUrl(section, params), location.origin);
  if (push && route.url !== current.url) {
    maxIndex = current.index + 1;
    current = { ...current, ...route, index: maxIndex, transient: true };
    history.pushState({ axon: current }, '', route.url);
  } else {
    current = { ...current, ...route };
    history.replaceState({ axon: current }, '', route.url);
  }
  checkpoint();
}

function close(params) {
  const previous = current?.transient && current?.index > 0;
  if (previous) history.back();
  else go(routeUrl(current.section, params), { replace: true });
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (internal) { if (a) e.preventDefault(); return; }
  if (!ready || !a || a.target === '_blank' || a.hasAttribute('download')) return;
  const u = new URL(a.href, location.origin);
  if (u.origin !== location.origin || !readRoute(u.href)) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) {
    // Real links retain the browser's open-in-new-tab behavior.
    e.stopImmediatePropagation(); return;
  }
  e.preventDefault();
  e.stopImmediatePropagation();
  void go(u.href, { remember: a.classList.contains('tab-btn') || a.hasAttribute('data-resume') });
}, true);

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-axon-back]')) history.back();
  if (e.target.closest('[data-axon-forward]')) history.forward();
  if (e.target.closest('[data-axon-copy]')) {
    navigator.clipboard.writeText(location.href).then(() => document.dispatchEvent(new CustomEvent('axon:link-copied')));
  }
});
window.addEventListener('popstate', async (e) => {
  if (!ready) return;
  const route = readRoute(location.href);
  if (!route) return;
  const state = e.state?.axon?.v === 1 ? { ...e.state.axon, ...route } : fresh(route);
  const old = current;
  if (restoring) { restoring = false; return; }
  if (await pages()[old?.section]?.canLeave?.(route) === false) {
    restoring = true;
    history.go((old?.index || 0) - state.index || 1);
    return;
  }
  remember();
  await apply(state);
});
window.addEventListener('pagehide', checkpoint);
window.addEventListener('beforeunload', (e) => {
  checkpoint();
  if (pages()[current?.section]?.dirty?.()) { e.preventDefault(); e.returnValue = ''; }
});
main()?.addEventListener('scroll', checkpoint, { passive: true });

async function start() {
  if (!domReady || ready || document.querySelector('#main-screen')?.classList.contains('hidden')) return;
  decorate();
  new MutationObserver(decorate).observe(document.querySelector('.sidebar-nav'), { childList: true });
  ready = true;
  history.scrollRestoration='manual';
  const route = readRoute(location.href) || readRoute('/');
  const entry = history.state?.axon;
  const stored = saved[route.section];
  const state = entry?.v === 1 && entry.url === route.url ? { ...entry, ...route }
    : fresh(route, 0, stored?.url === route.url ? stored.view : null);
  maxIndex = Math.max(state.index,historyMax[state.chain] || 0);
  history.replaceState({ axon: state }, '', route.url);
  await apply(state);
}

window.AxonNavigation = { go, update, close, checkpoint, url: routeUrl, sections: SECTIONS,
  saved: () => saved, get ready() { return ready; }, get applying() { return applying; },
  get current() { return current; }, controls };
document.addEventListener('axon:authenticated', start);
if (!domReady) document.addEventListener('DOMContentLoaded',()=>{domReady=true;void start();});
else start();
