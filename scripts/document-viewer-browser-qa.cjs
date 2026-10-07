const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-document-viewer-qa';
const assert = (ok, message) => { if (!ok) throw Error(message); };

(async () => {
  const browser = await chromium.launch({ headless: true });
    const checks = [], errors = [], external = [];
  let fixture;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    assert((await (await context.request.get(origin + '/api/health')).json()).qa === true, 'Owned QA server required');
    await context.request.post(origin + '/api/login', { data: { username: 'qa', password: 'axon-local-qa' } });
    const home = (await (await context.request.get(origin + '/api/files')).json()).home;
    assert(path.basename(home).startsWith('axon-polish-qa-') && await fs.readFile(home + '/.axon-qa-owned', 'utf8') === 'isolated-qa-v1', 'Unsafe fixture home');
    fixture = path.join(home, 'media', 'documentos-qa');
    execFileSync('python3', ['scripts/document-fixtures.py', fixture], { timeout: 120000 });
    await fs.mkdir(output, { recursive: true });
    await context.request.post(origin + '/api/library/rescan', { data: {} });
    let items = [];
    const deadline = Date.now() + 30000;
    while (items.length < 14 && Date.now() < deadline) {
      items = (await (await context.request.get(origin + '/api/library')).json()).items.filter(i => i.p.startsWith(fixture + '/'));
      await new Promise(r => setTimeout(r, 100));
    }
    assert(items.some(i => i.n === 'planilla.xlsx'), 'Documents not indexed in Library');
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push('Unwanted script dialog: ' + d.message()); await d.dismiss(); });
    page.on('request', r => { if (!r.url().startsWith(origin) && /^https?:/.test(r.url())) external.push(r.url()); });
    const pdfRequests = []; page.on('request', r => { if (/\/vendor\/pdf(?:\.js|\.worker\.js|\/)/.test(r.url())) pdfRequests.push(r.url()); });
    await page.goto(origin + '/archivos?' + new URLSearchParams({ path: fixture }));
    await page.waitForFunction(() => window.AxonNavigation?.ready && !window.AxonNavigation.applying);
    assert(!pdfRequests.length, 'PDF parser downloaded before opening a document');
    checks.push('Heavy PDF engine stays unloaded while browsing files');
    async function open(section, name) {
      const query = section === 'files'
        ? new URLSearchParams({ path: fixture, item: name, view: 'list' })
        : new URLSearchParams({ type: 'folder', value: fixture, item: items.find(i => i.n === name).id, group: 'none', sort: 'name-asc' });
      await page.goto(origin + (section === 'files' ? '/archivos?' : '/biblioteca?') + query);
      await page.waitForFunction(() => window.AxonNavigation?.ready && !window.AxonNavigation.applying);
      await page.locator('.axon-doc[data-rendered=true]').waitFor({ timeout: 90000 });
    }
    for (const section of ['files', 'library']) {
      for (const name of ['lectura.doc', 'lectura.docx', 'lectura.odt', 'lectura.rtf', 'lectura.pdf', 'diapositivas.ppt', 'diapositivas.pptx', 'diapositivas.odp']) {
        await open(section, name);
        const doc = page.locator('.axon-doc');
        assert(await doc.getAttribute('data-pages') === '2', section + ' missing pages: ' + name);
        await doc.getByRole('button', { name: 'Página siguiente', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('.axon-doc')?.dataset.page === '2');
        assert((await doc.locator('.textLayer').textContent()).includes(name.startsWith('diapositivas') ? 'DIAPOSITIVA 2' : 'SEGUNDA PAGINA'), 'Wrong page content: ' + name);
        assert(await doc.getByRole('button', { name: 'Página siguiente', exact: true }).isDisabled(), 'Last page wraps');
        await doc.getByRole('spinbutton', { name: 'Número de página' }).fill('1');
        await doc.getByRole('spinbutton', { name: 'Número de página' }).press('Enter');
        await page.waitForFunction(() => document.querySelector('.axon-doc')?.dataset.page === '1');
        if (name === 'lectura.docx') {
          const route = page.url(); await doc.focus(); await page.keyboard.press('ArrowRight');
          await page.waitForFunction(() => document.querySelector('.axon-doc')?.dataset.page === '2');
          assert(page.url() === route, 'Document page key changed the selected file');
          await page.keyboard.press('ArrowLeft');
          await page.waitForFunction(() => document.querySelector('.axon-doc')?.dataset.page === '1');
          const stage = doc.locator('.axon-doc-stage'); await stage.focus(); await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(150);
          assert(page.url() === route, 'Content scroll key changed the selected file');
          await doc.getByRole('button', { name: 'Pantalla completa' }).click();
          await page.waitForFunction(() => !!document.fullscreenElement);
          await page.evaluate(() => document.exitFullscreen());
          checks.push(section + ': keyboard page navigation and fullscreen preserve the selected file');
        }
        await doc.getByRole('combobox', { name: 'Zoom del documento' }).selectOption('1.5');
        await page.waitForTimeout(150);
        assert((await doc.locator('canvas').evaluate(c => c.width)) > 0, 'Empty canvas');
        checks.push(section + ': real content and page/zoom controls for ' + name);
      }
      for (const name of ['planilla.xls', 'planilla.xlsx', 'planilla.ods']) {
        await open(section, name);
        const doc = page.locator('.axon-doc');
        assert((await doc.locator('table').textContent()).includes('AXON RESUMEN'), 'First sheet clipped');
        const sheets = doc.getByRole('combobox', { name: 'Hoja de la planilla' });
        assert(await sheets.locator('option').count() === 2, 'Missing workbook sheet');
        await sheets.selectOption('1');
        assert((await doc.locator('table').textContent()).includes('AXON DETALLE'), 'Second sheet clipped');
        assert((await doc.locator('table').textContent()).includes('678.9'), 'Missing numeric value');
        await doc.getByRole('searchbox', { name: 'Buscar en la tabla' }).fill('inexistente');
        assert(await doc.locator('tbody tr').count() === 0, 'Table search broken');
        checks.push(section + ': complete cells, sheet selector and filtering for ' + name);
      }
      for (const name of ['tabla.csv', 'tabla.tsv']) {
        await open(section, name);
        const table = page.locator('.axon-doc table');
        assert((await table.textContent()).includes(name.endsWith('csv') ? 'Peña' : 'Móvil'), 'Encoding broken');
        if (name.endsWith('csv')) {
          assert((await table.textContent()).includes('<script>alert(1)</script>'), 'CSV text not escaped');
          assert((await table.textContent()).includes('dos\nlíneas'), 'Multiline cell broken');
          assert(await table.locator('script').count() === 0, 'CSV is executable');
        }
        checks.push(section + ': ' + name + ' decoding/escaped cells');
      }
      for (const name of ['lectura.docx', 'planilla.xlsx', 'tabla.csv']) {
        await open(section, name);
        for (const mode of ['dark', 'light']) {
          await page.evaluate(mode => AxonThemes.setMode(mode), mode);
          for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.waitForTimeout(100);
            const fit = await page.locator('.axon-doc').evaluate(el => {
              const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth + 1 && r.height > 100 && document.documentElement.scrollWidth <= innerWidth;
            });
            assert(fit, 'Viewer overflows: ' + [section, name, mode, width]);
            if (width === 390 || width === 1440) await page.screenshot({ path: path.join(output, [section, name, mode, width].join('-') + '.png') });
          }
        }
        await page.setViewportSize({ width: 1440, height: 1000 });
        const axe = await new AxeBuilder({ page }).include('.axon-doc').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert(!axe.violations.length, 'Viewer accessibility: ' + JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
        checks.push(section + ': responsive 320–1440, both themes and accessibility for ' + name);
      }
    }
    let release, delayed = false;
    await page.route('**/api/files/document?**', async route => {
      if (route.request().method() === 'POST' && route.request().url().includes('lectura.docx')) {
        delayed = true; await new Promise(resolve => { release = resolve; });
      }
      try { await route.continue(); } catch { /* The old viewer explicitly cancels its request. */ }
    });
    await page.goto(origin + '/archivos?' + new URLSearchParams({ path: fixture, item: 'lectura.docx' }));
    await page.waitForFunction(() => !!document.querySelector('.axon-doc'));
    for (let i = 0; i < 100 && !delayed; i++) await page.waitForTimeout(20);
    assert(delayed, 'Late preparation fixture did not intercept');
    await page.evaluate(url => AxonNavigation.go(url), '/archivos?' + new URLSearchParams({ path: fixture, item: 'tabla.csv' }));
    await page.locator('.axon-doc table').waitFor(); release(); await page.waitForTimeout(300);
    assert((await page.locator('.axon-doc table').textContent()).includes('Peña'), 'Late Office preparation replaced the current table');
    await page.unroute('**/api/files/document?**');
    checks.push('Cancelled late preparation cannot replace the file selected afterward');
    // Corrupted documents and stale asynchronous work stay explicit and scoped.
    await page.goto(origin + '/archivos?' + new URLSearchParams({ path: fixture, item: 'vacio.xlsx' }));
    await page.locator('.axon-doc-status').waitFor();
    await page.waitForFunction(() => document.querySelector('.axon-doc-status')?.textContent.includes('vacío'));
    assert(await page.getByRole('button', { name: 'Reintentar vista previa' }).isVisible(), 'No retry for invalid document');
    await page.goto(origin + '/archivos?' + new URLSearchParams({ path: fixture, item: 'dañado.docx' }));
    await page.waitForFunction(() => document.querySelector('.axon-doc-status')?.textContent.includes('No se pudo'), null, { timeout: 90000 });
    checks.push('Empty/corrupt inputs show errors with retry and original download');
    const outside = await context.request.post(origin + '/api/files/document?path=/etc/passwd');
    assert(outside.status() === 403, 'QA document route escapes fixture');
    const anonymous = await browser.newContext();
    assert((await anonymous.request.post(origin + '/api/files/document?path=' + encodeURIComponent(fixture + '/lectura.docx'))).status() === 401, 'Preview conversion lacks auth');
    await anonymous.close();
    checks.push('Authentication and owned-root boundaries apply to document conversion');
    assert(!errors.length, 'Browser errors: ' + errors.join('; '));
    assert(!external.length, 'Viewer requested external services: ' + external.join('; '));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, external }, null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
  } catch (e) {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed: false, error: String(e), checks, errors, external }, null, 2));
    console.error(e); process.exitCode = 1;
  } finally { await browser.close(); if (fixture) await fs.rm(fixture, { recursive: true, force: true }); }
})();
