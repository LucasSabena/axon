const { chromium } = require(process.env.AXON_QA_PLAYWRIGHT_ENTRY || 'playwright');
const base = 'http://127.0.0.1:3459';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const now = Date.now() / 1000;
function result(query) {
  const summary = { input: 1000000, output: 10000, cacheRead: 2000000, cacheWrite: 10000, reasoning: 2000, cacheWrite1h: 4000,
    total: 3020000, requests: 30, sessions: 3, usd: 4.55, pricedRequests: 20, unpricedRequests: 10, partialRequests: 0,
    components: { input: 2, output: .1, cacheRead: .4, cacheWrite: .05 } };
  const groups = [{ ...summary, agent: 'codex', provider: 'openai', model: 'gpt-fixture', account: 'unknown', accountBasis: 'unknown', priceModel: 'openai/gpt-fixture', priceBasis: 'provider', rates: { input: 2, output: 10, cacheRead: .2, cacheWrite: 2.5 } },
    { ...summary, agent: 'opencode', provider: 'fixture-relay', model: '<img src=x onerror=alert(1)>', account: 'unknown', accountBasis: 'unknown', priceModel: null, rates: null, pricedRequests: 0 }];
  return { ok: true, agent: query.get('agent'), period: query.get('period'), timezone: 'America/Argentina/Buenos_Aires', summary,
    groups: query.get('model') ? groups.filter(g => g.model === query.get('model')) : groups, daily: [{ ...summary, day: '2026-10-03' }, { ...summary, day: '2026-10-04' }],
    facets: { provider: ['openai', 'fixture-relay'], model: ['gpt-fixture', '<img src=x onerror=alert(1)>'], account: ['unknown'] }, accountLabels: { unknown: 'Cuenta no registrada' },
    prices: { stale: false, fetchedAt: now, source: 'models.dev', automaticHours: 24 },
    coverage: { indexing: false, pending: 0, firstAt: now - 86400, lastAt: now, warnings: [], unsupported: [], accountAttribution: 'Cuenta no registrada no se atribuye a la cuenta activa.' }, generatedAt: now };
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); const errors = [], queries = []; let outage = false, refreshed = false;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Argentina/Buenos_Aires' });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await context.route('**/api/agent-consumption**', async route => {
      const url = new URL(route.request().url()); queries.push(url.searchParams.get('period'));
      if (url.pathname.endsWith('/prices/refresh')) refreshed = route.request().method() === 'POST' && route.request().postData() === '{}';
      if (outage) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Fixture: proveedor no disponible' }) });
      const data = result(url.searchParams);
      if (url.searchParams.get('agent') === 'devin') { data.summary = { ...data.summary, total: 0, requests: 0, pricedRequests: 0 }; data.groups = []; data.daily = []; data.coverage.unsupported = ['Devin no expone un historial de tokens por modelo.']; }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(base); await page.locator('#username').fill('qa'); await page.locator('#password').fill('axon-local-qa');
    await page.locator('#login-form').evaluate(f => f.requestSubmit()); await page.waitForFunction(() => document.querySelector('#login-screen').classList.contains('hidden'));
    await page.goto(base + '/agentes?id=codex&tab=consumption');
    await page.locator('.ag-consumption-model').first().waitFor({ timeout: 60000 });
    assert(await page.getByRole('button', { name: 'Consumo', exact: true }).getAttribute('class').then(s => s.includes('active')), 'Consumption deep link not restored');
    const panel = page.locator('[data-agent-consumption-panel]');
    for (const period of ['today', '7', '15', '30', 'all']) {
      await panel.locator('[data-consumption-filter=period]').selectOption(period);
      await page.waitForFunction(() => !document.querySelector('[data-agent-consumption-panel]').hasAttribute('aria-busy'));
      assert(queries.at(-1) === period, 'Period not sent: ' + period);
    }
    await panel.locator('[data-consumption-filter=model]').selectOption('gpt-fixture');
    await page.waitForFunction(() => !document.querySelector('[data-agent-consumption-panel]').hasAttribute('aria-busy'));
    assert(await panel.locator('.ag-consumption-model').count() === 1, 'Model filter failed');
    await panel.locator('[data-consumption-filter=model]').selectOption('');
    await page.waitForFunction(() => !document.querySelector('[data-agent-consumption-panel]').hasAttribute('aria-busy'));
    assert(await panel.locator('img').count() === 0, 'Model name became executable markup');
    await panel.getByRole('button', { name: 'Actualizar precios', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-agent-consumption-panel]').hasAttribute('aria-busy')); assert(refreshed, 'Price refresh not dispatched');
    outage = true; await panel.getByRole('button', { name: 'Actualizar consumo', exact: true }).click();
    await panel.getByText('Se muestra la última lectura disponible', { exact: false }).waitFor(); assert(await panel.locator('.ag-consumption-model').count() === 2, 'Outage discarded matching cached data'); outage = false;
    await panel.locator('[data-consumption-filter=agent]').selectOption('devin'); await panel.locator('.ag-consumption-empty').waitFor();
    await panel.getByText('Devin no expone un historial', { exact: false }).waitFor();
    await panel.locator('[data-consumption-filter=agent]').selectOption('all'); await panel.locator('.ag-consumption-model').first().waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 }); await panel.scrollIntoViewIfNeeded();
      const box = await panel.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1, 'Clipped consumption panel ' + width);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflow ' + width);
      await panel.locator('.ag-consumption-price').first().evaluate(el => el.open = true); await panel.locator('.ag-consumption-daily').evaluate(el => el.open = true);
      assert(await page.evaluate(() => document.querySelector('[data-agent-consumption-panel]').scrollWidth <= document.querySelector('[data-agent-consumption-panel]').clientWidth + 1), 'Details overflow ' + width);
      await page.screenshot({ path: '/tmp/axon-consumption-qa-' + width + '.png', fullPage: true });
    }
    assert(!errors.length, JSON.stringify(errors));
    console.log(JSON.stringify({ periods: ['today', '7', '15', '30', 'all'], modelFilter: true, safeText: true, refreshPrices: true,
      cachedOnFailure: true, unsupportedDevin: true, mobile: [390, 320], browserErrors: errors, realProviderRequests: false }));
    await context.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
