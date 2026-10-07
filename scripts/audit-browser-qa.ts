import { chromium, type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SECTIONS } from '../public/navigation-model.js';

// An owned fixture server is mandatory. Never authorize operations against a
// user server just because a hostname or a port happens to look local.
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Use the isolated QA server');
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-browser-audit';
await mkdir(path.join(output, 'screens'), { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.AXON_QA_BROWSER_CHANNEL ? { channel: process.env.AXON_QA_BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
const errors: string[] = [], apiErrors: { url: string; status: number }[] = [];
const checks: any[] = [];
let page: Page;
async function check(name: string, run: () => Promise<unknown>) {
  try { const evidence = await run(); checks.push({ name, passed: true, evidence }); console.log('PASS ' + name); }
  catch (error) {
    checks.push({ name, passed: false, error: String(error) }); console.error('FAIL ' + name + ': ' + error);
    await page?.screenshot({path:path.join(output,'screens','failure-'+name.replace(/[^a-z0-9-]/gi,'-')+'.png')}).catch(()=>{});
  }
}
async function scan(name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const violations = result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }));
  if (violations.length) throw new Error(JSON.stringify(violations));
  return { name, violations: 0 };
}
try {
  const marker = await context.request.get(origin + '/api/health');
  if (!(await marker.json()).qa) throw new Error('This server is not an isolated AXON QA fixture');
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('response', response => {
    if (response.url().startsWith(origin + '/api/') && response.status() >= 400)
      apiErrors.push({ url: new URL(response.url()).pathname, status: response.status() });
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('#username').waitFor();
  await check('login accessibility', () => scan('login'));
  await page.locator('#username').fill('qa');
  await page.locator('#password').fill('axon-local-qa');
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#main-screen:not(.hidden)').waitFor();
  await page.waitForFunction(() => (window as any).AxonNavigation?.ready);
  for (const theme of ['axon', 'paper']) {
    await page.evaluate(t => { (window as any).AxonThemes.setMode(t === 'axon' ? 'dark' : 'light'); (window as any).setTheme(t); }, theme);
    for (const [section, [url]] of Object.entries(SECTIONS)) {
      await check(theme + '/' + section, async () => {
        await page.evaluate(u => (window as any).AxonNavigation.go(u), url);
        await page.locator('#tab-' + section + '.active').waitFor();
        await page.waitForFunction(() => !(window as any).AxonNavigation.applying);
        // Wait for finite UI transitions before checking geometry/contrast.
        await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
        const geometry = await page.evaluate(() => ({ active: document.querySelectorAll('.tab-content.active').length, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        if (geometry.active !== 1 || geometry.scrollWidth > geometry.width + 1) throw new Error('Invalid layout: ' + JSON.stringify(geometry));
        const accessibility = await scan(theme + '/' + section);
        await page.screenshot({ path: path.join(output, 'screens', theme + '-' + section + '.png') });
        return { geometry, accessibility };
      });
    }
  }
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 960 });
    for (const [section, [url]] of Object.entries(SECTIONS)) await check(width + '/' + section, async () => {
      await page.evaluate(u => (window as any).AxonNavigation.go(u), url);
      await page.locator('#tab-' + section + '.active').waitFor();
      await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
      const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      if (overflow.scrollWidth > width + 1) throw new Error('Horizontal overflow: ' + JSON.stringify(overflow));
      if (width === 390) await page.screenshot({ path: path.join(output, 'screens', 'mobile-' + section + '.png') });
      return overflow;
    });
  }
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ origin, sections: Object.keys(SECTIONS).length, checks, errors, apiErrors, hostMutations: 0 }, null, 2));
  await context.close(); await browser.close();
}
if (checks.some(c => !c.passed) || errors.length || apiErrors.length) {
  console.error(JSON.stringify({ failedChecks: checks.filter(c => !c.passed), errors, apiErrors }));
  throw new Error('Audit failed; see ' + path.join(output, 'report.json'));
}
console.log(JSON.stringify({ passed: checks.length, sections: Object.keys(SECTIONS).length, errors: errors.length, apiErrors: apiErrors.length }));
