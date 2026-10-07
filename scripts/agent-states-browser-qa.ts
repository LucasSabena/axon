import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Exercise the same installation states on developer machines and clean CI
// runners. Native agent discovery on the host must not determine QA coverage.
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Use the isolated QA server');
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-agent-states-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.AXON_QA_BROWSER_CHANNEL ? { channel: process.env.AXON_QA_BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
const checks: unknown[] = [];
const agents = [
  { id: 'codex', name: 'Codex', installed: false, counts: {} },
  { id: 'claude', name: 'Claude', installed: true, residual: true, counts: {} },
  { id: 'opencode', name: 'OpenCode', installed: true, counts: { skills: 2 } },
];
try {
  if (!(await (await context.request.get(origin + '/api/health')).json()).qa) throw new Error('Not an owned QA fixture');
  await context.route(/\/api\/agents$/, route => route.fulfill({ json: { agents } }));
  const page = await context.newPage();
  await page.goto(origin);
  await page.locator('#username').fill('qa');
  await page.locator('#password').fill('axon-local-qa');
  await page.locator('#login-form button[type=submit]').click();
  await page.locator('#main-screen:not(.hidden)').waitFor();
  await page.goto(origin + '/agentes');
  await page.waitForFunction(() => (window as any).AxonNavigation?.ready);
  const missing = page.locator('.agent-row.agent-off[data-id=codex]');
  const residual = page.locator('.agent-row.agent-resid[data-id=claude]');
  await missing.getByText('no detectado', { exact: true }).waitFor();
  await residual.getByText('residual', { exact: true }).waitFor();
  await page.locator('.agent-row[data-id=opencode]').getByText('2 skills', { exact: true }).waitFor();
  for (const theme of ['axon', 'paper']) {
    await page.evaluate(t => { (window as any).AxonThemes.setMode(t === 'axon' ? 'dark' : 'light'); (window as any).setTheme(t); }, theme);
    // No browser restart between states: test focus, hover and selection on
    // the actual actionable button, including its accent background.
    for (const state of ['idle', 'hover', 'selected']) {
      if (state === 'idle') { await page.mouse.move(0, 0); await page.goto(origin + '/agentes'); await missing.waitFor(); }
      if (state === 'hover') await missing.hover();
      if (state === 'selected') { await missing.focus(); await page.keyboard.press('Enter'); await page.locator('.agent-off.active[data-id=codex]').waitFor(); }
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
      });
      const result = await new AxeBuilder({ page }).include('#agents-rail').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      if (result.violations.length) throw new Error(JSON.stringify({ theme, state, violations: result.violations }));
      await page.screenshot({ path: path.join(output, theme + '-' + state + '.png') });
      checks.push({ theme, state, violations: 0, installed: true, missing: true, residual: true });
      console.log('PASS agent installation states ' + theme + '/' + state);
    }
  }
} finally {
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, hostMutations: 0 }, null, 2));
  await context.close(); await browser.close();
}
