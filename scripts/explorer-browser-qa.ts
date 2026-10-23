/** Unified Archivos/Biblioteca explorer: navigation pane, menus, selection model, library bridge, gallery, overview and mobile drawer. */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Isolated QA only');
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-explorer-qa';
await mkdir(output, { recursive: true });
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const checks: string[] = [];
const errors: string[] = [];

// A valid 8x8 PNG so the library classifies and thumbnails it like a photo.
const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
const png = (r: number, g: number, b: number) => {
  const head = Buffer.alloc(13); head.writeUInt32BE(8, 0); head.writeUInt32BE(8, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 8 }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 8 }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e: Error) => errors.push(e.message));
const go = (url: string) => page.evaluate((u: string) => (window as any).AxonNavigation.go(u), url);
const api = (url: string, body?: unknown) => page.evaluate(async ({ url, body }: any) => {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  return { status: r.status, data: await r.json().catch(() => ({})) };
}, { url, body });

try {
  await page.goto(origin + '/archivos');
  await page.locator('#username').fill('qa'); await page.locator('#password').fill('axon-local-qa'); await page.locator('#login-form button[type=submit]').click();
  await page.waitForFunction(() => (window as any).AxonNavigation?.ready && (window as any).AxonExplorer);
  await page.waitForFunction(() => ((document.querySelector('#fm-location') as HTMLInputElement | null)?.value || '').startsWith('/'));
  const root = (await page.locator('#fm-location').inputValue()).replace(/\/$/, '');
  assert(root.startsWith('/'), 'Fixture root unavailable');

  // ---- fixtures: a photo folder inside the library root, plain files outside it
  await mkdir(root + '/media/Fotos', { recursive: true });
  await writeFile(root + '/media/Fotos/rojo.png', png(220, 60, 60));
  await writeFile(root + '/media/Fotos/azul.png', png(60, 90, 220));
  await mkdir(root + '/explorer/sub/deep', { recursive: true });
  await writeFile(root + '/explorer/nota.txt', 'hola');
  await writeFile(root + '/explorer/sub/hoja.txt', 'hoja');
  await writeFile(root + '/explorer/sub/deep/fondo.txt', 'fondo');
  await api('/api/library/rescan', {});

  // ---- 1. navigation pane structure
  await go('/archivos?' + new URLSearchParams({ path: root + '/explorer/sub/deep', view: 'list' }));
  await page.locator('.fm-row[data-name="fondo.txt"]').waitFor();
  for (const id of ['quick', 'pc', 'library', 'tags', 'cloud', 'system']) await page.locator(`.fm-nav-sec[data-sec="${id}"]`).waitFor();
  assert(await page.locator('#fm-nav [role=tree]').count() >= 5, 'Navigation trees missing');
  checks.push('navigation pane renders every section');

  // ---- 2. tree reveals and highlights the current folder
  const current = page.locator('#fm-nav .fm-nav-i[aria-current=page][data-path$="/explorer/sub/deep"]');
  await current.waitFor();
  assert(await page.locator('#fm-nav .fm-nav-i[data-path$="/explorer/sub"][aria-expanded=true]').count() >= 1, 'Ancestor not expanded');
  assert(await page.locator('#fm-nav .fm-nav-i[aria-current=page]').count() === 1, 'More than one current node');
  await current.focus();
  await page.keyboard.press('ArrowLeft');
  assert((await page.evaluate(() => (document.activeElement as HTMLElement).dataset.path || '')).endsWith('/explorer/sub'), 'ArrowLeft did not move to the parent');
  await page.keyboard.press('ArrowLeft');
  assert(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('aria-expanded')) === 'false', 'ArrowLeft did not collapse');
  await page.keyboard.press('ArrowRight');
  assert(await page.evaluate(() => (document.activeElement as HTMLElement).getAttribute('aria-expanded')) === 'true', 'ArrowRight did not expand');
  await page.keyboard.press('Home');
  assert((await page.evaluate(() => (document.activeElement as HTMLElement).dataset.navKey || '')).startsWith('sec:'), 'Home did not reach the first entry');
  checks.push('tree reveal, current marker and ARIA keyboard model');

  // ---- 3. selection model: click selects, double click opens
  await go('/archivos?' + new URLSearchParams({ path: root + '/explorer', view: 'list' }));
  await page.locator('.fm-row[data-name="sub"]').waitFor();
  await page.locator('.fm-row[data-name="sub"]').click();
  assert(await page.locator('.fm-row.fm-selected[data-name="sub"]').count() === 1, 'Click did not select');
  assert(!(await page.url()).includes('sub'), 'A single click navigated');
  await page.locator('.fm-row[data-name="nota.txt"]').click({ modifiers: ['Shift'] });
  assert(await page.locator('.fm-row.fm-selected').count() === 2, 'Shift range did not extend the selection');
  await page.locator('#fm-selbar:not(.hidden)').waitFor();
  assert(await page.locator('#fm-sel-share').isVisible(), 'Share missing for a file selection');
  await page.locator('.fm-row[data-name="sub"]').dblclick();
  await page.waitForFunction(() => location.search.includes('sub'));
  await page.locator('.fm-row[data-name="hoja.txt"]').waitFor();
  checks.push('single click selects, double click opens, selection bar shows share');

  // ---- 4. context menu layout + keyboard
  await page.locator('.fm-row[data-name="hoja.txt"]').click({ button: 'right' });
  const menu = page.locator('#ctx-menu');
  await menu.waitFor();
  for (const label of ['Cortar', 'Copiar', 'Pegar', 'Renombrar', 'Eliminar', 'Abrir', 'Vista previa', 'Descargar', 'Compartir link…', 'Colores, etiquetas y marcas…', 'Favorito', 'Mover a…', 'Copiar a…', 'Más acciones', 'Propiedades']) {
    assert(await menu.getByText(label, { exact: true }).count() >= 1 || await menu.getByRole('button', { name: label }).count() >= 1, 'Menu entry missing: ' + label);
  }
  await menu.focus();
  await page.keyboard.press('ArrowDown');
  assert(await page.evaluate(() => document.activeElement?.closest('#ctx-menu') !== null), 'Menu focus lost');
  await page.getByRole('menuitem', { name: 'Más acciones' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.locator('.ctx-sub').waitFor();
  assert(await page.locator('.ctx-sub').getByText('Copiar ruta').count() === 1, 'Submenu entries missing');
  await page.keyboard.press('ArrowLeft');
  assert(await page.locator('.ctx-sub').count() === 0, 'ArrowLeft kept the submenu');
  await page.keyboard.press('Escape');
  assert(await menu.isHidden(), 'Escape kept the menu open');
  await page.locator('#fm-list').click({ button: 'right', position: { x: 300, y: 400 } });
  await menu.getByText('Nueva carpeta', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  checks.push('grouped context menu with submenu and keyboard control');

  // ---- 5. library tools from any file, and the offer for folders the library does not index yet
  await go('/archivos?' + new URLSearchParams({ path: root + '/media/Fotos', view: 'list' }));
  await page.locator('.fm-row[data-name="rojo.png"]').click({ button: 'right' });
  await menu.getByText('Optimizar / convertir…', { exact: true }).waitFor();
  await menu.getByText('Compartir link…', { exact: true }).click();
  await page.locator('#lib-modal:not(.hidden)').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#lib-modal.hidden').waitFor({ state: 'attached' });
  const resolved = await api('/api/library/resolve', { paths: [root + '/media/Fotos/rojo.png', root + '/explorer/nota.txt'] });
  assert(resolved.data.items.length === 1 && resolved.data.outside.length === 1, 'Resolve did not split indexed and outside files');
  await go('/archivos?' + new URLSearchParams({ path: root + '/explorer', view: 'list' }));
  await page.locator('.fm-row[data-name="nota.txt"]').click({ button: 'right' });
  await menu.getByText('Compartir link…', { exact: true }).click();
  await page.locator('#confirm-modal[open]').waitFor({ state: 'attached' });
  assert(((await page.locator('#confirm-modal').getAttribute('label')) || '').includes('biblioteca'), 'No offer to add the folder to the library');
  await page.keyboard.press('Escape');
  checks.push('share and optimize reach library items; outside folders get an offer, not an error');

  // ---- 6. embedded gallery: same tab, same sidebar entry
  await page.locator('#fm-nav [data-nav-key="lib:all:"]').click();
  await page.locator('#tab-files.fm-mode-gallery #tab-library.active .lib-tile').first().waitFor();
  assert(await page.locator('.sidebar-nav .tab-btn[data-tab="files"].active').count() === 1, 'Archivos entry not active in gallery mode');
  assert(await page.locator('.sidebar-nav .tab-btn[data-tab="library"]').count() === 0, 'Biblioteca still has its own sidebar entry');
  assert(await page.locator('#fm-nav .fm-nav-i[aria-current=page][data-nav-key="lib:all:"]').count() === 1, 'Gallery location not highlighted');
  await page.locator('.lib-tile').first().click({ button: 'right' });
  await menu.getByText('Compartir link…', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.goBack();
  await page.locator('#tab-files:not(.fm-mode-gallery) #fm-main').waitFor();
  checks.push('gallery lives inside Archivos and keeps one sidebar entry');

  // ---- 7. command bar: sort menu, expandable filters, sidebar toggle
  await go('/archivos?' + new URLSearchParams({ path: root + '/explorer', view: 'list' }));
  await page.locator('.fm-row[data-name="nota.txt"]').waitFor();
  assert(await page.locator('#fm-drawer').isHidden(), 'Filters drawer open by default');
  await page.locator('#fm-sort-btn').click();
  await menu.getByText('Tamaño', { exact: true }).click();
  await page.waitForFunction(() => location.search.includes('sort=size'));
  await page.locator('#fm-more-btn').click();
  await page.locator('#fm-drawer').waitFor({ state: 'visible' });
  await page.locator('#fm-kind').selectOption('dir');
  assert((await page.locator('#fm-filter-summary').innerText()).includes('1 filtro'), 'Active filter not summarized');
  await page.locator('#fm-clear-filters').click();
  await page.keyboard.press('Control+b');
  await page.locator('#tab-files.fm-nav-hidden').waitFor();
  await page.keyboard.press('Control+b');
  await page.locator('#tab-files:not(.fm-nav-hidden)').waitFor();
  checks.push('sort menu, expandable filters and Ctrl+B');

  // ---- 8. "Este equipo" overview
  await go('/archivos?pc=1');
  await page.locator('#fm-pc .fm-pc-drive').first().waitFor();
  assert(await page.locator('#fm-pc .fm-pc-card').count() >= 1, 'Folders missing in the overview');
  assert(page.url().includes('pc=1'), 'Overview URL lost');
  await page.locator('#fm-pc .fm-pc-drive[href]').first().click();
  await page.locator('#fm-main:not(.hidden) .fm-row').first().waitFor();
  await page.goBack();
  await page.locator('#fm-pc .fm-pc-drive').first().waitFor();
  checks.push('overview of folders and drives with history');

  // ---- 9. accessibility of the pane, the folder view and an open menu
  await go('/archivos?' + new URLSearchParams({ path: root + '/explorer', view: 'list' }));
  await page.locator('.fm-row[data-name="nota.txt"]').click({ button: 'right' });
  await menu.waitFor();
  const axe = await new AxeBuilder({ page }).include('#tab-files').include('#ctx-menu').disableRules(['color-contrast']).analyze();
  const serious = axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''));
  assert(!serious.length, 'Accessibility: ' + serious.map((v) => v.id + ' ' + v.nodes[0]?.html.slice(0, 120)).join('; '));
  await page.keyboard.press('Escape');
  checks.push('axe: no serious violations in the explorer');

  // ---- 10. mobile drawer
  await page.setViewportSize({ width: 390, height: 844 });
  await go('/archivos?' + new URLSearchParams({ path: root + '/explorer', view: 'list' }));
  await page.locator('.fm-row[data-name="nota.txt"]').waitFor();
  assert(await page.locator('#fm-nav').isHidden(), 'Navigation drawer open on mobile by default');
  await page.locator('#fm-nav-toggle').click();
  await page.locator('#fm-nav').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.locator('#fm-nav').waitFor({ state: 'hidden' });
  await page.locator('#fm-nav-toggle').click();
  await page.locator('#fm-nav .fm-nav-i[data-path$="/explorer/sub"]').first().click();
  await page.locator('#fm-nav').waitFor({ state: 'hidden' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow on mobile');
  checks.push('mobile drawer opens, closes on Escape and after navigating');

  await page.screenshot({ path: output + '/explorer-mobile.png' });
  assert(!errors.length, 'Browser errors: ' + errors.join(' | '));
  console.log(JSON.stringify({ ok: true, checks, errors }, null, 2));
} finally {
  await browser.close();
}
