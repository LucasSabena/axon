async page => {
  if (new URL(page.url()).host !== '127.0.0.1:3459') throw new Error('Use the isolated QA server on port 3459');
  const assert = (v, m) => { if (!v) throw new Error(m); };
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto('http://127.0.0.1:3459/salud');
  await page.waitForFunction(() => !document.querySelector('#login-screen').classList.contains('hidden') || !document.querySelector('#main-screen').classList.contains('hidden'));
  if (await page.locator('#username').isVisible()) {
    await page.locator('#username').fill('qa'); await page.locator('#password').fill('axon-local-qa'); await page.locator('#login-form button[type=submit]').click();
  }
  await page.locator('#opt-apps tr[data-id]').first().waitFor();
  const live = await page.evaluate(async () => (await (await fetch('/api/optimizer')).json()).snapshot);
  assert(live.apps.length >= 21 && live.cpu.cores === 16 && !live.errors.length, 'Live server inventory/metrics missing');
  assert(live.apps.filter(a => a.auditedLocal).length === 2, 'Exactly the audited local databases must be enrolled');
  assert(!live.apps.some(a => a.canStop && !a.auditedLocal), 'Unsupported apps must remain protected');
  const [initialPlan] = await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/optimizer/plan'),page.locator('#opt-plan').click()]);
  if(initialPlan.status()===403) {
    assert((await initialPlan.json()).error.startsWith('QA:'),'Host effect guard must explain its boundary');
  } else {
    assert(initialPlan.ok(),'Read-only plan request failed');
    await page.waitForFunction(()=>document.querySelector('#confirm-modal').open || document.querySelector('#opt-op-result').textContent.includes('Se mantienen encendidas'));
    if(await page.locator('#confirm-body').isVisible()){await page.locator('#confirm-cancel').click();await page.locator('#confirm-body').waitFor({state:'hidden'});await page.locator('#confirm-body').waitFor({state:'hidden'});}
  }
  await page.locator('#opt-search').fill('steel'); assert(await page.locator('#opt-apps tr[data-id]').count() === 1, 'Search did not filter');
  await page.locator('#opt-search').fill('');
  await page.screenshot({ path: '/tmp/axon-optimizer-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#tab-ops').scrollWidth <= innerWidth), 'Mobile overflow');
  await page.screenshot({ path: '/tmp/axon-optimizer-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 960 });

  // Operational paths are simulated. No docker stop/start/prune reaches the host.
  const fake = structuredClone(live);
  const app = fake.apps.find(a => a.name === 'homepage'); assert(app, 'Homepage fixture missing');
  let applies = 0, undos = 0, choices = 0, busyDuringApply = false;
  const receipt = { id: 'qa-receipt', at: Date.now(), before: 92, after: 35, items: [{ id: app.id, name: app.name, created: app.created, status: 'stopped' }], complete: true };
  await page.route('**/api/optimizer/apps/*', async route => { choices++; app.importance = route.request().postDataJSON().importance; app.canStop = app.importance === 'sometimes'; app.blocked = app.canStop ? null : 'Siempre encendida'; await route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/optimizer', route => route.fulfill({ json: { ok: true, snapshot: fake } }));
  await page.route('**/api/optimizer/plan', route => route.fulfill({ json: { ok: true, token: 'qa-token', apps: [app], cleanup: route.request().postDataJSON().cleanup, expiresAt: Date.now() + 60_000 } }));
  await page.route('**/api/optimizer/apply', async route => { applies++; const result = structuredClone(receipt); if (busyDuringApply) { result.items[0].status = 'skipped'; result.items[0].error = 'En uso: 1 conexión abierta, incluso si está esperando.'; } else { app.state = 'exited'; app.canStop = false; } fake.receipts = [result]; await route.fulfill({ json: { ok: true, receipt: result } }); });
  await page.route('**/api/optimizer/undo', async route => { undos++; app.state = 'running'; app.canStop = true; fake.receipts[0].items[0].status = 'restored'; await route.fulfill({ json: { ok: true, receipt: fake.receipts[0] } }); });
  const select = page.getByRole('combobox', { name: 'Cuándo necesitás homepage' });
  await select.selectOption('sometimes'); await page.locator('#confirm-modal[open] #confirm-body').waitFor(); await page.locator('#confirm-cancel').click();await page.locator('#confirm-body').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('[data-importance]')?.value==='unknown');
  assert(choices === 0 && await select.inputValue() === 'unknown', 'Cancel must preserve classification');
  await select.selectOption('sometimes'); await page.locator('#confirm-ok').click();
  await page.waitForFunction(() => !!document.querySelector('[data-stop]'));
  assert(choices === 1, 'Classification not saved once');
  await page.locator('#opt-plan').click(); await page.locator('#confirm-modal[open] #confirm-body').waitFor();
  assert((await page.locator('#confirm-body').textContent()).includes('volverá a revisar'), 'Preview must explain the fresh activity check');
  await page.locator('#confirm-cancel').click();await page.locator('#confirm-body').waitFor({state:'hidden'}); assert(applies === 0, 'Cancelled preview executed mutation');
  await page.locator('#opt-plan').click(); await page.locator('#confirm-ok').click();
  await page.locator('[data-undo="qa-receipt"]').waitFor(); assert(applies === 1, 'Apply must occur once');
  await page.locator('[data-undo="qa-receipt"]').click(); await page.locator('#confirm-ok').click();
  await page.getByRole('button', { name: 'Restauradas' }).waitFor(); assert(undos === 1, 'Undo must occur once');
  busyDuringApply = true;
  await page.locator('#opt-plan').click(); await page.locator('#confirm-ok').click();
  await page.locator('#opt-receipts').filter({ hasText: 'se mantuvo encendida' }).waitFor();
  assert(await page.locator('[data-undo="qa-receipt"]').count() === 0, 'Skipped apps must not offer restoration');
  assert((await page.locator('#opt-op-result').textContent()).includes('Se omitieron'), 'Busy result must explain the skip');
  await page.route('**/api/optimizer', route => route.fulfill({ status: 503, json: { ok: false, error: 'QA unavailable' } }));
  await page.locator('#ops-refresh').click(); await page.locator('#opt-status').filter({ hasText: 'No se pudo actualizar' }).waitFor();
  assert(await page.locator('#opt-plan').isDisabled(), 'Failed measurements must disable actions');
  assert(await page.locator('#main-screen').isVisible(), '503 must retain authentication');
  await page.unrouteAll({ behavior: 'wait' });
  // Compatibility: public/ is live-mounted while the backend may be an older image.
  await page.route('**/api/me', async route => { const r = await route.fetch(); const data = await r.json(); delete data.capabilities; await route.fulfill({ json: data }); });
  await page.reload(); await page.locator('#main-screen:not(.hidden)').waitFor();
  assert(await page.locator('#optimizer').count() === 0, 'Older backend must retain existing UI');
  assert(await page.locator('#ops-grid').isVisible(), 'Older backend Salud was hidden');
  await page.unrouteAll({ behavior: 'wait' }); await page.reload(); await page.locator('#opt-apps tr[data-id]').first().waitFor();
  assert(errors.length === 0, 'Browser errors: ' + errors.join('; '));
  await page.evaluate(report => { window.__optimizerQA = report; }, { liveInventory: live.apps.length, liveCpu: live.cpu.busy, desktop: true, mobile390: true, auditedDbEnrollment: true, observationExplained: true, classificationCancel: true, previewCancel: true, applyAndRestore: true, busyAppSkipped: true, skippedUndoHidden: true, transientError: true, oldBackendCompatibility: true, browserErrors: errors.length, operationalPathsMocked: true, realContainersStopped: 0, realCachesDeleted: 0 });
}
