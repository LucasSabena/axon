const playwright = require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const origin = 'http://127.0.0.1:3459';
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'axon-media-browser-'));
  const engine = process.env.AXON_QA_BROWSER || 'chromium';
  const browser = await playwright[engine].launch({ ...(engine === 'chromium' ? { channel: 'chrome' } : {}), headless: true });
  const results = [], errors = [];
  const assert = (v, message) => { if (!v) throw Error(message); };
  try {
    const audio = path.join(dir, 'audio.wav'), mp4 = path.join(dir, 'video.mp4'), mov = path.join(dir, 'original.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=60', audio]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:d=60', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=0.5', '-c:v', 'prores_ks', '-pix_fmt', 'yuv422p10le', '-threads', '1', mov]);
    const audioBytes = await fs.readFile(audio), videoBytes = await fs.readFile(mp4), incompatibleBytes = await fs.readFile(mov);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.request.post(origin + '/api/login', { data: { username: 'qa', password: 'axon-local-qa' } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const items = [
      ...[1, 2, 3].map(n => ({ id: 'audio' + n, n: `0${n} Audio.wav`, k: 'audio', e: 'wav', s: audioBytes.length, d: 60 })),
      { id: 'native', n: '04 Video.mp4', k: 'video', e: 'mp4', s: videoBytes.length, d: 60, w: 160, h: 90 },
      { id: 'fallback', n: '05 ProRes.mov', k: 'video', e: 'mov', c: 'apch', s: incompatibleBytes.length, d: .5, w: 64, h: 64 },
    ].map(it => ({ ...it, p: dir + '/' + it.n, m: Date.now(), tk: it.id, th: -1, mx: 1, nw: 0, wv: 0 }));
    const index = { ok: true, items, home: dir, roots: [dir], uploadRoot: dir, favorites: [], collections: [], directories: [dir], shares: 0, revision: 1, scannedAt: Date.now() };
    let delayedIndex = false, indexStarted = false, releaseIndex;
    let delayedPost = false, postStarted = false, releasePost, webPosts = 0, webPolls = 0;
    await page.route('**/api/library', async r => {
      if (delayedIndex) { indexStarted = true; await new Promise(resolve => { releaseIndex = resolve; }); delayedIndex = false; }
      await r.fulfill({ json: index });
    });
    await page.route('**/api/library/status*', r => r.fulfill({ json: { ok: true, count: items.length, revision: 1, scanning: false } }));
    await page.route('**/api/library/rescan*', r => r.fulfill({ json: { ok: true } }));
    await page.route('**/api/library/file/*', r => {
      const id = new URL(r.request().url()).pathname.split('/').pop();
      return r.fulfill({ contentType: id.startsWith('audio') ? 'audio/wav' : id === 'fallback' ? 'video/quicktime' : 'video/mp4', body: id.startsWith('audio') ? audioBytes : id === 'fallback' ? incompatibleBytes : videoBytes });
    });
    await page.route('**/api/library/web/**', async r => {
      if (r.request().method() === 'POST') {
        webPosts++; postStarted = true;
        if (delayedPost) await new Promise(resolve => { releasePost = resolve; });
        return r.fulfill({ json: { ok: true, state: 'queued' } });
      }
      if (r.request().url().endsWith('/status')) { webPolls++; return r.fulfill({ json: { ok: true, state: 'done', pct: 100 } }); }
      return r.fulfill({ contentType: 'video/mp4', body: videoBytes });
    });
    await page.goto(origin + '/biblioteca?sort=name-asc&group=none');
    await page.waitForFunction(() => window.AxonNavigation?.ready && !window.AxonNavigation.applying);
    await page.locator('[data-id="audio1"]').first().click();
    await page.locator('.lv-compact audio').waitFor();
    await page.waitForFunction(() => !AxonNavigation.applying);
    const title = () => page.locator('.lv-title b').textContent();
    assert((await title()).includes('01'), 'Wrong opening audio');
    assert(await page.locator('#lib-viewer').getAttribute('aria-modal') === null, 'Audio must not trap the library');
    assert(!await page.evaluate(() => document.body.classList.contains('lib-noscroll')), 'Audio locks library scroll');
    assert(await page.locator('#lv-prev').isDisabled(), 'First audio wraps backwards');
    await page.evaluate(() => { window.previousAudio = document.querySelector('audio'); });
    await page.locator('#lv-next').click(); await page.locator('#lv-next').click();
    assert((await title()).includes('03'), 'Next audio must skip videos');
    assert(await page.locator('#lv-next').isDisabled(), 'Last audio loops unexpectedly');
    await page.evaluate(() => window.previousAudio.dispatchEvent(new Event('ended')));
    assert((await title()).includes('03'), 'Removed audio triggered stale advancement');
    await page.locator('#lv-prev').click();
    await page.locator('audio').focus(); await page.keyboard.press('ArrowRight');
    assert((await title()).includes('02'), 'Native audio seek navigates between files');
    results.push('Audio-only queue, bounds, stopped previous audio, stale ended event and native keyboard controls');

    delayedIndex = true;
    await page.locator('#lib-refresh').click();
    for (let i = 0; i < 100 && !indexStarted; i++) await page.waitForTimeout(10);
    assert(indexStarted, 'Refresh did not begin');
    await page.locator('#lv-next').click(); releaseIndex();
    await page.waitForTimeout(250);
    assert((await title()).includes('03'), 'Late refresh restored the old audio');
    assert(new URL(page.url()).searchParams.get('item') === 'audio3', 'URL and player diverged after refresh');
    await page.locator('#lib-sort').selectOption('name-desc');
    assert((await title()).includes('03'), 'Sort changed current playback');
    await page.locator('#lib-sort').selectOption('name-asc');
    await page.locator('#lv-prev').click();
    await page.evaluate(() => document.querySelector('audio').dispatchEvent(new Event('ended')));
    assert((await title()).includes('03'), 'Ended did not advance to next audio');
    await page.evaluate(() => document.querySelector('audio').dispatchEvent(new Event('ended')));
    assert((await title()).includes('03'), 'Ended loops at the end of the queue');
    results.push('Late library response and sorting preserve current audio; sequential playback ends at final track');

    for (const mode of ['dark', 'light']) {
      await page.evaluate(mode => AxonThemes.setMode(mode), mode);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const geometry = await page.locator('#lib-viewer').evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bg: getComputedStyle(el).backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth }; });
        assert(geometry.x >= 0 && geometry.x + geometry.width <= width && geometry.height < 250 && !geometry.overflow, 'Audio bar exceeds viewport: ' + JSON.stringify({ mode, width, geometry }));
        assert(geometry.bg !== 'rgba(0, 0, 0, 0)', 'Missing audio bar surface token');
        if (width === 390 || width === 1440) await page.screenshot({ path: `/tmp/axon-audio-${engine}-${mode}-${width}.png` });
      }
    }
    results.push('Compact audio bar at 320, 390, 768 and 1440 px in both themes');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('[data-id="native"]').first().click();
    await page.waitForFunction(() => document.querySelector('#lv-stage video')?.readyState >= 2);
    assert(webPosts === 0, 'Native video was unnecessarily converted');
    await page.locator('#lv-next').click();
    await page.waitForFunction(() => document.querySelector('#lv-stage video')?.src.includes('/web/'));
    assert(webPosts === 1 && webPolls === 1, 'Unsupported original needs automatic one-time fallback');
    await page.locator('#lv-prev').click();
    items.find(it => it.id === 'fallback').wv = 0;
    await page.locator('#lv-next').click();
    await page.waitForFunction(() => document.querySelector('#lv-stage video')?.src.includes('/web/'));
    // Reload index to clear the browser's cached wv flag for a late preparation response.
    await page.keyboard.press('Escape'); await page.locator('#lib-viewer').waitFor({ state: 'hidden' });
    await page.locator('#lib-refresh').click(); await page.waitForTimeout(250);
    delayedPost = true; postStarted = false;
    await page.locator('[data-id="fallback"]').first().click();
    for (let i = 0; i < 100 && !postStarted; i++) await page.waitForTimeout(10);
    assert(postStarted, 'Unsupported original did not start compatibility request');
    await page.locator('#lv-prev').click();
    const pollsBefore = webPolls; releasePost(); await page.waitForTimeout(200);
    assert((await title()).includes('04'), 'Late compatibility response switched back to previous video');
    assert(webPolls === pollsBefore, 'Detached video keeps polling');
    assert(!await page.locator('#lv-stage video').getAttribute('src').then(src => src.includes('/web/')), 'Late preparation replaced current media');
    await page.keyboard.press('Escape'); await page.locator('#lib-viewer').waitFor({ state: 'hidden' });
    results.push('Native video plays directly; ProRes prepares automatically; late compatibility request cannot replace current media');
    assert(errors.length === 0, 'Browser errors: ' + errors.join('; '));
    console.log(JSON.stringify({ passed: true, engine, results, errors }));
    await context.close();
  } finally { await browser.close(); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
