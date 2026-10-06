const { chromium } = require('/home/user/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base = 'http://127.0.0.1:3459';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const now = Math.floor(Date.now() / 1000);
const quota = (id, remaining, extra = {}) => ({ id, label: id, provider: 'codex', plan: 'plus', email: id + '@example.test', status: 'ok', stale: false,
  source: 'API del proveedor', credentialSource: 'Fixture de QA', fetchedAt: now, windows: [{ id: 'session', label: '5 horas', remainingPercent: remaining, usedPercent: 100 - remaining, resetsAt: now + 3760 }, { id: 'weekly', label: 'Semanal', remainingPercent: 55, usedPercent: 45, resetsAt: now + 86400 }], balances: [], ...extra });
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = []; let calls = 0, outage = false, secretSubmitted = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await context.route('**/api/agent-usage/**', async route => {
      const url = new URL(route.request().url()), agent = url.pathname.split('/')[3]; calls++;
      if (outage) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture: consulta no disponible' }) });
      let entries;
      if (agent === 'codex' || agent === 'claude') {
        const res = await context.request.get(base + '/api/agent-accounts/' + agent); const profiles = (await res.json()).profiles;
        entries = profiles.map((p, i) => quota(p.id, i ? 100 : 23, { label: p.label, email: p.email, plan: agent === 'claude' ? 'pro' : 'plus' }));
      } else if (agent === 'devin') {
        entries = [quota('devin-local', 0, { provider: 'devin', status: 'not_connected', plan: null, windows: [], fetchedAt: null, authMethod: 'Windsurf', label: 'Devin CLI' })];
        if (url.pathname.endsWith('/connect')) {
          const input = route.request().postDataJSON(); secretSubmitted = input.accessToken === 'QA-TOKEN-PRIVATE-123456789';
          entries.push(quota('u-0123456789abcdef', 64, { label: input.label, provider: 'devin', accountId: input.organization }));
        }
      } else entries = [quota('go', 68, { provider: 'opencode-go', label: 'OpenCode Go', windows: [
        { id: 'rolling', label: '5 horas', remainingPercent: 68, usedPercent: 32, resetsAt: now + 3600 },
        { id: 'weekly', label: 'Semanal', remainingPercent: 55, usedPercent: 45, resetsAt: now + 86400 },
        { id: 'monthly', label: 'Mensual', remainingPercent: 43, usedPercent: 57, resetsAt: null },
      ] }), quota('needs-auth', 0, { label: 'Cuenta vencida', status: 'reconnect', windows: [], fetchedAt: null }),
      quota('stale', 12, { label: '<img src=x onerror=alert(1)>', status: 'rate_limited', stale: true, fetchedAt: now - 600 })];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, agent, accounts: entries, refreshSeconds: 120 }) });
    });
    await page.goto(base); await page.locator('#username').fill('qa'); await page.locator('#password').fill('axon-local-qa');
    await page.locator('#login-form').evaluate(f => f.requestSubmit()); await page.waitForFunction(() => document.querySelector('#login-screen').classList.contains('hidden'));
    await page.goto(base + '/agentes?id=codex&tab=provider');
    await page.locator('[data-account-usage] progress').first().waitFor({ timeout: 60000 });
    assert(await page.locator('[data-account-usage]').first().getByText('23%', { exact: false }).count() > 0, 'Missing per-account remainder');
    const before = calls; await page.getByRole('button', { name: 'Actualizar cuotas', exact: true }).click();
    assert(calls > before, 'Manual refresh was not dispatched');
    outage = true; await page.getByRole('button', { name: 'Actualizar cuotas', exact: true }).click();
    await page.getByText('Lectura anterior', { exact: true }).first().waitFor();
    assert(await page.locator('[data-account-usage] progress').count() >= 2, 'Failure discarded last valid quota'); outage = false;
    await page.screenshot({ path: '/tmp/axon-usage-qa-codex.png', fullPage: true });
    for (const agent of ['claude', 'opencode', 'devin']) {
      await page.goto(base + '/agentes?id=' + agent + '&tab=provider');
      await page.getByRole('button', { name: 'Actualizar cuotas', exact: true }).waitFor({ timeout: 60000 });
      if (agent === 'opencode') {
        await page.getByText('Mensual', { exact: true }).waitFor(); await page.getByText('Reinicio no informado', { exact: true }).waitFor();
        assert(await page.locator('[data-agent-usage-panel] img').count() === 0, 'Provider text became markup');
      }
      if (agent === 'devin') {
        await page.getByRole('button', { name: 'Conectar consulta', exact: true }).click();
        const form = page.locator('.ag-usage-connect-form');
        await form.locator('[name=label]').fill('Empresa QA'); await form.locator('[name=organization]').fill('org-fixture');
        await form.locator('[name=accessToken]').fill('QA-TOKEN-PRIVATE-123456789');
        await page.waitForTimeout(4500);
        assert(await form.locator('[name=accessToken]').inputValue() === 'QA-TOKEN-PRIVATE-123456789', 'Polling erased credential input');
        await form.getByRole('button', { name: 'Guardar consulta' }).click();
        await page.getByText('Empresa QA', { exact: true }).waitFor();
        assert(secretSubmitted, 'Connection did not send its intended secret');
        assert(!(await page.locator('body').innerText()).includes('QA-TOKEN-PRIVATE'), 'Secret escaped into rendered output');
        assert(await page.locator('[name=accessToken]').inputValue() === '', 'Secret input was not cleared');
      }
      await page.screenshot({ path: '/tmp/axon-usage-qa-' + agent + '.png', fullPage: true });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.reload();
        await page.getByRole('button', { name: 'Actualizar cuotas', exact: true }).waitFor({ timeout: 60000 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile overflow: ' + agent + ' ' + width);
        const bounds = await page.locator('.agd-pane.active').boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Usage panel clipped: ' + agent + ' ' + width);
        await page.screenshot({ path: '/tmp/axon-usage-qa-' + agent + '-' + width + '.png', fullPage: true });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    assert(!errors.length, JSON.stringify(errors));
    console.log(JSON.stringify({ inlineAccountQuotas: true, refresh: true, staleOnOutage: true, monthly: true, unknownReset: true,
      safeProviderText: true, devinConnection: true, secretCleared: true, formSurvivesPolling: true, mobile: [390, 320], browserErrors: errors, realProviderRequests: false }));
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
