import { chromium } from 'playwright';
import { createSession } from '../src/auth';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const origin = process.env.AXON_PRODUCTION_QA_ORIGIN || 'https://ports.binaryserver.com.ar';
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-markdown-production-qa';
await mkdir(output, { recursive: true });
const config = process.env.CONFIG_PATH || 'data/config.json';
const username = await readFile(config, 'utf8').then(text => JSON.parse(text).auth.username).catch(error => {
  if (error.code !== 'EACCES') throw error;
  return execFileSync('sudo', ['-n', 'python3', '-c', 'import json,sys; print(json.load(open(sys.argv[1]))["auth"]["username"])', config], { encoding: 'utf8' }).trim();
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors: string[] = [], checks: string[] = [];
page.on('pageerror', e => errors.push(e.message));
await context.addCookies([{ name: 'axon_session', value: await createSession(username), url: origin, httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'Lax' }]);
const assert = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
const api = async (url: string) => { const response = await context.request.get(origin + url); assert(response.ok(), 'API failed: ' + response.status()); return response.json(); };
try {
  await page.goto(origin + '/archivos');
  await page.waitForFunction(() => (window as any).AxonNavigation?.ready);
  if (process.env.AXON_PRODUCTION_QA_MARKER) {
    await Bun.write(output + '/browser-ready', 'ready');
    console.log('Authenticated browser/cache ready before Markdown deployment.');
    const deadline = Date.now() + 600000;
    while (!await Bun.file(process.env.AXON_PRODUCTION_QA_MARKER).exists()) {
      if (Date.now() > deadline) throw Error('Deployment wait expired');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await page.reload(); await page.waitForFunction(() => (window as any).AxonNavigation?.ready);
    checks.push('Existing authenticated browser/cache reload after deployment');
  }
  const library = await api('/api/library');
  const item = library.items.find((it: any) => it.e === 'md' && it.s > 0 && it.s < 100000 && /^readme\.md$/i.test(it.n))
    || library.items.find((it: any) => it.e === 'md' && it.s > 0 && it.s < 100000);
  assert(item, 'No existing Markdown item in Library');
  const parent = item.p.slice(0, item.p.lastIndexOf('/'));
  const readUrl = '/api/files/read?path=' + encodeURIComponent(item.p);
  const original = (await api(readUrl)).content;
  const filesUrl = '/archivos?' + new URLSearchParams({ path: parent, item: item.n, view: 'list' });
  const go = (url: string) => page.evaluate(url => (window as any).AxonNavigation.go(url), url);
  await go(filesUrl); await page.locator('.axon-doc[data-rendered=true]').waitFor();
  assert(await page.locator('#fm-editor-text').isHidden(), 'Production Markdown default is not reading');
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => (window as any).AxonThemes.setMode(mode), mode);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width < 769) await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().right <= 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Production Files overflow');
      await page.screenshot({ path: output + '/files-' + mode + '-' + width + '.png' });
    }
  }
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  const textarea = page.locator('#fm-editor-text'), before = await textarea.inputValue();
  await textarea.fill(before + '\n\n## AXON QA: borrador temporal sin guardar\n');
  await page.keyboard.press('Control+e'); await page.locator('.axon-doc[data-rendered=true]').waitFor();
  assert((await page.locator('.axon-markdown').textContent())?.includes('borrador temporal sin guardar'), 'Production draft preview missing');
  assert((await api(readUrl)).content === original, 'View switch changed original file');
  await page.keyboard.press('Control+e'); await textarea.fill(before);
  assert(await page.locator('#fm-dirty-dot').isHidden(), 'Production restored editor still dirty');
  await page.keyboard.press('Control+e');
  checks.push('Real file default reading, buttons, Ctrl+E and unsaved draft preservation without file writes');
  await go('/biblioteca?' + new URLSearchParams({ type: 'folder', value: parent, item: item.id, group: 'none' }));
  await page.locator('.axon-doc[data-rendered=true]').waitFor();
  assert(await page.locator('#lv-stage iframe').count() === 0, 'Production Library still uses an iframe');
  for (const mode of ['light', 'dark']) {
    await page.evaluate(mode => (window as any).AxonThemes.setMode(mode), mode);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width < 769) await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().right <= 0);
      const readable = await page.locator('.axon-markdown').evaluate(el => {
        const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
        return rect.x >= 0 && rect.right <= innerWidth + 1 && style.color !== getComputedStyle(el.parentElement!).backgroundColor;
      });
      assert(readable, 'Production Library text is not readable');
      await page.screenshot({ path: output + '/library-' + mode + '-' + width + '.png' });
    }
  }
  checks.push('Real Library Markdown, no iframe, both modes, Files/Library 320/390/1440px');
  assert((await api(readUrl)).content === original, 'Original content changed during production QA');
  assert(!errors.length, 'Production runtime errors: ' + errors.join('; '));
  await Bun.write(output + '/report.json', JSON.stringify({ passed: true, checks, errors, userFilesChanged: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors, userFilesChanged: false, output }));
} finally {
  await context.request.post(origin + '/api/logout', { headers: { Origin: origin }, data: {} }).catch(() => {});
  await browser.close();
}
