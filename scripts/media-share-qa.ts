import { mock } from 'bun:test';
import { Hono } from 'hono';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

// A dedicated process: redirect only the library's home discovery into its
// fixture, keeping the real ffmpeg jobs and access checks. No production data.
const dir = await mkdtemp(path.join(tmpdir(), 'axon-media-share-'));
process.env.CONFIG_PATH = path.join(dir, 'config.json');
process.env.SESSION_SECRET = crypto.randomUUID();
const host = { ...await import('../src/host') }, realExec = host.hostExec;
mock.module('../src/host', () => ({ ...host, hostExec: (command: string, opts: any) => command === 'printf %s "$HOME"'
  ? Promise.resolve({ ok: true, code: 0, stdout: dir, stderr: '', command }) : realExec(command, opts) }));
const { registerLibraryRoutes } = await import('../src/library');
const playwright = createRequire('/home/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('playwright');
const assert = (v: any, message: string) => { if (!v) throw Error(message); };
async function command(args: string[]) {
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code) throw Error(err); return out;
}
let server: ReturnType<typeof Bun.serve>, browser: any;
try {
  const media = path.join(dir, 'media'); await mkdir(media); await mkdir(path.join(dir, 'library'));
  for (const name of ['01 Audio.wav', '03 Audio.wav']) await command(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=60', path.join(media, name)]);
  await command(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(media, '02 Video.mp4')]);
  await command(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=1', '-c:v', 'prores_ks', '-pix_fmt', 'yuv422p10le', '-threads', '1', path.join(media, '04 ProRes.mov')]);
  await writeFile(path.join(dir, 'library/state.json'), JSON.stringify({ roots: [media], uploadRoot: media, shareBase: '', favorites: [], collections: [], shares: [] }));
  const app = new Hono(); registerLibraryRoutes(app);
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch });
  const origin = `http://127.0.0.1:${server.port}`;
  const request = async (url: string, body?: any, method = body ? 'POST' : 'GET') => {
    const response = await fetch(origin + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() as any };
  };
  await request('/api/library/rescan?wait=1', {});
  const items = (await request('/api/library')).data.items.sort((a: any, b: any) => a.n.localeCompare(b.n));
  assert(items.length === 4, 'Owned media fixture missing');
  const shared = (await request('/api/library/shares', { ids: items.map((i: any) => i.id), title: 'QA reproducción', cdn: false, notifyActivity: false })).data.share;
  const engine = process.env.AXON_QA_BROWSER || 'chromium';
  browser = await playwright[engine].launch({ ...(engine === 'chromium' ? { channel: 'chrome' } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(origin + '/s/' + shared.id);
  await page.locator('[data-ix="0"]').click(); await page.locator('#lbb audio').waitFor();
  assert(await page.locator('#lb').evaluate((el: HTMLElement) => el.getBoundingClientRect().height < 220), 'Shared audio fills screen');
  await page.locator('#lbnx').click(); assert((await page.locator('#lbn').textContent()).includes('03'), 'Shared audio queue includes a video');
  assert(await page.locator('#lbnx').isDisabled(), 'Shared audio loops at the end');
  await page.locator('#lbb audio').focus(); await page.keyboard.press('ArrowLeft');
  assert((await page.locator('#lbn').textContent()).includes('03'), 'Native audio seeking navigates gallery');
  await page.locator('#lbp').click(); await page.evaluate(() => document.querySelector('#lbb audio')!.dispatchEvent(new Event('ended')));
  assert((await page.locator('#lbn').textContent()).includes('03'), 'Shared ended skips next audio');
  await page.keyboard.press('Escape'); await page.locator('#lb').waitFor({ state: 'hidden' });
  await page.locator('[data-ix="3"]').click();
  await page.waitForFunction(() => (document.querySelector('#lbb video') as HTMLVideoElement)?.src.includes('/w/'));
  await page.waitForFunction(() => (document.querySelector('#lbb video') as HTMLVideoElement)?.readyState >= 2);
  const progress = (await request('/s/' + shared.id + '/st')).data.files[3];
  assert(progress.w && progress.state === 'done', 'Real fallback was not persisted');
  const asset = await fetch(origin + '/s/' + shared.id + '/w/3.mp4', { headers: { Range: 'bytes=0-127' } });
  assert(asset.status === 206 && (await asset.arrayBuffer()).byteLength === 128, 'Compatible range playback failed');
  const original = await readFile(path.join(media, '04 ProRes.mov'));
  const download = await fetch(origin + '/s/' + shared.id + '/f/3?dl=1');
  assert(Buffer.from(await download.arrayBuffer()).equals(original), 'Original download changed');
  assert((await fetch(origin + '/s/' + shared.id + '/prepare/99', { method: 'POST' })).status === 404, 'Invalid index can prepare private files');
  assert((await fetch(origin + '/s/' + shared.id + '/prepare/0', { method: 'POST' })).status === 404, 'Non-video can be queued');
  const protectedShare = (await request('/api/library/shares', { ids: [items[3].id], password: 'fixture-only', cdn: false, notifyActivity: false })).data.share;
  assert((await fetch(origin + '/s/' + protectedShare.id + '/prepare/0', { method: 'POST' })).status === 401, 'Locked share can start playback work');
  await request('/api/library/shares/' + shared.id, undefined, 'DELETE');
  assert((await fetch(origin + '/s/' + shared.id + '/prepare/3', { method: 'POST' })).status === 404, 'Revoked share can start work');
  assert(!errors.length, errors.join('; '));
  console.log(JSON.stringify({ passed: true, engine, compactSharedAudio: true, audioQueue: true, realProResFallback: true, rangePlayback: true, originalPreserved: true, lockedAndRevokedDenied: true, errors }));
} finally {
  await browser?.close(); server?.stop(true);
  // Library saves are debounced; let them finish before removing their home.
  await new Promise(resolve => setTimeout(resolve, 1000));
  await rm(dir, { recursive: true, force: true });
}
