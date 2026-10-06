import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Real browser HTTP and service-worker caches, with the previously deployed
// player. All other APIs use the isolated QA server; no production mutation.
const legacy = process.env.AXON_QA_LEGACY_MEDIA || 'docs/media-playback-2026-10-05/legacy-player';
const oldJS = await readFile(path.join(legacy, 'feat-library.js'));
const oldCSS = await readFile(path.join(legacy, 'feat-library.css'));
const fixedHTML = await readFile('public/index.html', 'utf8');
const staleHTML = fixedHTML.replace(/\/feat-library\.js\?v=[^"\s]+/g, '/feat-library.js?v=5').replace(/\/feat-library\.css\?v=[^"\s]+/g, '/feat-library.css?v=3');
const dir = await mkdtemp(path.join(tmpdir(), 'axon-library-cache-'));
const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=40', path.join(dir, 'audio.wav')], { stdout: 'pipe', stderr: 'pipe' });
const stderr = new Response(proc.stderr).text();
if (await proc.exited) throw Error(await stderr);
const audio = await readFile(path.join(dir, 'audio.wav'));
const items = [1, 2].map(i => ({ id: 'audio' + i, n: `0${i} Audio.wav`, p: `${dir}/0${i} Audio.wav`, k: 'audio', e: 'wav', s: audio.length, m: Date.now(), d: 40, tk: 'audio' + i, th: -1, mx: 1 }));
const requests = new Map<string, number>();
let phase: 'legacy' | 'stale' | 'fixed' = 'legacy';
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
  const url = new URL(req.url), key = url.pathname + url.search;
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/library') return Response.json({ ok: true, items, home: dir, roots: [dir], uploadRoot: dir, favorites: [], collections: [], directories: [], shares: 0, revision: 1, scannedAt: Date.now() });
    if (url.pathname === '/api/library/status') return Response.json({ ok: true, count: 2, revision: 1 });
    if (url.pathname.startsWith('/api/library/file/')) return new Response(audio, { headers: { 'Content-Type': 'audio/wav' } });
    const headers = new Headers(req.headers); headers.set('Origin', 'http://127.0.0.1:3459'); headers.set('Host', '127.0.0.1:3459'); headers.set('Accept-Encoding', 'identity');
    return fetch('http://127.0.0.1:3459' + key, { method: req.method, headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: await req.arrayBuffer() } : {}) });
  }
  if (url.pathname === '/biblioteca' || url.pathname === '/') return new Response(phase === 'fixed' ? fixedHTML : staleHTML, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'private, no-store' } });
  const filename = url.pathname.slice(1);
  if (filename.includes('..')) return new Response(null, { status: 404 });
  const file = Bun.file('public/' + filename);
  if (!await file.exists()) return new Response(null, { status: 404 });
  if (filename === 'feat-library.js' || filename === 'feat-library.css') {
    requests.set(key, (requests.get(key) || 0) + 1);
    return new Response(phase === 'legacy' ? filename.endsWith('.js') ? oldJS : oldCSS : file, { headers: { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : 'text/css', 'Cache-Control': 'public, max-age=14400' } });
  }
  return new Response(file, { headers: { 'Cache-Control': 'no-cache' } });
} });
const origin = `http://127.0.0.1:${server.port}`;
const playwright = createRequire(process.env.AXON_QA_PLAYWRIGHT_ENTRY || require.resolve('playwright/package.json'))('playwright');
const engine = process.env.AXON_QA_BROWSER || 'chromium';
const browser = await playwright[engine].launch({ ...(engine === 'chromium' ? { channel: 'chrome' } : {}), headless: true });
const check = (v: any, message: string) => { if (!v) throw Error(message); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.request.post(origin + '/api/login', { data: { username: 'qa', password: 'axon-local-qa' } });
  const page = await context.newPage();
  await page.goto(origin + '/biblioteca?sort=name-asc&group=none');
  await page.waitForFunction(() => (window as any).AxonNavigation?.ready && !(window as any).AxonNavigation.applying);
  await page.locator('[data-id="audio1"]').first().click(); await page.locator('#lv-stage audio').waitFor();
  check(!await page.locator('#lib-viewer').evaluate((el: HTMLElement) => el.classList.contains('lv-compact')), 'Legacy fixture is already compact');
  const before = { js: requests.get('/feat-library.js?v=5'), css: requests.get('/feat-library.css?v=3') };
  phase = 'stale'; await page.reload();
  await page.locator('#lv-stage audio').waitFor();
  check(!await page.locator('#lib-viewer').evaluate((el: HTMLElement) => el.classList.contains('lv-compact')), 'Did not reproduce stale cached library');
  check(requests.get('/feat-library.js?v=5') === before.js && requests.get('/feat-library.css?v=3') === before.css, 'Browser did not keep the old assets cached');
  phase = 'fixed'; await page.reload();
  await page.locator('.lv-compact audio').waitFor();
  await page.locator('#lv-next').click();
  check((await page.locator('.lv-title b').textContent()).includes('02 Audio'), 'Updated cached session did not navigate to the next audio');
  check(await page.locator('#lv-next').isDisabled(), 'Cached-session queue does not stop at the last audio');
  const newAssets = [...requests.keys()].filter(key => !key.endsWith('v=5') && !key.endsWith('v=3'));
  check(newAssets.length === 2, 'Normal reload did not fetch the two content-versioned assets');
  console.log(JSON.stringify({ passed: true, engine, staleSessionReproduced: true, ordinaryReloadFixed: true, compactLibraryAudio: true, stableNavigation: true, newAssets }));
} finally { await browser.close(); server.stop(true); await rm(dir, { recursive: true, force: true }); }
