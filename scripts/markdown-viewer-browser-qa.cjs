const { chromium } = require('playwright');
const { default: AxeBuilder } = require('@axe-core/playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
const output = process.env.AXON_QA_OUTPUT || '/tmp/axon-markdown-viewer-qa';
const assert = (ok, message) => { if (!ok) throw Error(message); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const checks = [], errors = [], heavy = [];
  let fixture;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    assert((await (await context.request.get(origin + '/api/health')).json()).qa === true, 'Owned QA server required');
    await context.request.post(origin + '/api/login', { data: { username: 'qa', password: 'axon-local-qa' } });
    const home = (await (await context.request.get(origin + '/api/files')).json()).home;
    assert(path.basename(home).startsWith('axon-polish-qa-') && await fs.readFile(home + '/.axon-qa-owned', 'utf8') === 'isolated-qa-v1', 'Unsafe fixture home');
    fixture = await fs.mkdtemp(path.join(home, 'media', 'markdown-qa-'));
    const sample = '# Guía de AXON\n\nTexto con **énfasis**, *cursiva*, ~~tachado~~ y `código`.\n\n## Lectura\n\n[Ir a lectura](#lectura) · [Otro archivo](otro.md)\n\n> Una cita legible.\n\n- Primero\n  - Anidado\n\n3. Tres\n4. Cuatro\n\n- [x] Terminado\n- [ ] Pendiente\n\n| Columna | Valor |\n| --- | --- |\n| Texto | Peña |\n\n```js\nconst ejemplo = "<script>";\n' + 'x'.repeat(300) + '\n```\n\n<script>window.markdownExecuted=true</script>\n<img src=x onerror="window.markdownExecuted=true">\n\n[Inseguro](javascript:alert(1))\n\n![Imagen local](imagen.svg)\n';
    const original = '\ufeff' + sample.replace(/\n/g, '\r\n');
    await Promise.all([
      fs.writeFile(fixture + '/guia.md', original), fs.writeFile(fixture + '/otro.md', '# Otro documento\n'),
      fs.writeFile(fixture + '/guia.markdown', sample), fs.writeFile(fixture + '/vacio.md', ''),
      fs.writeFile(fixture + '/grande.md', '# Documento grande\n\n' + 'contenido '.repeat(60000)),
      fs.writeFile(fixture + '/binario.md', Buffer.from([0, 1, 2, 255])), fs.writeFile(fixture + '/invalido.md', Buffer.from([255, 254, 250])),
      fs.writeFile(fixture + '/nota.txt', 'Texto normal'),
      fs.writeFile(fixture + '/imagen.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2563eb"/></svg>'),
    ]);
    await fs.mkdir(output, { recursive: true });
    await context.request.post(origin + '/api/library/rescan', { data: {} });
    let items = [];
    const deadline = Date.now() + 30000;
    while (items.length < 8 && Date.now() < deadline) {
      items = (await (await context.request.get(origin + '/api/library')).json()).items.filter(i => i.p.startsWith(fixture + '/'));
      await new Promise(r => setTimeout(r, 100));
    }
    assert(items.some(i => i.n === 'guia.markdown' && i.k === 'doc'), 'Markdown alias not indexed as a document');
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', async d => { errors.push('Unexpected dialog: ' + d.message()); await d.dismiss(); });
    page.on('request', r => { if (/\/vendor\/pdf|\/api\/(files|library)\/document/.test(r.url())) heavy.push(r.url()); });
    const filesUrl = (name, edit = false) => origin + '/archivos?' + new URLSearchParams({ path: fixture, item: name, view: 'list', ...(edit ? { edit: '1' } : {}) });
    async function open(section, name = 'guia.md') {
      await page.goto(section === 'files' ? filesUrl(name) : origin + '/biblioteca?' + new URLSearchParams({ type: 'folder', value: fixture, item: items.find(i => i.n === name).id, group: 'none' }));
      await page.waitForFunction(() => window.AxonNavigation?.ready && !window.AxonNavigation.applying);
      await page.locator('.axon-doc[data-rendered=true]').waitFor();
    }
    for (const section of ['files', 'library']) {
      await open(section);
      const article = page.locator('.axon-markdown');
      assert(await article.locator('h1').textContent() === 'Guía de AXON', 'Heading missing');
      assert(await article.locator('table td').last().textContent() === 'Peña', 'GFM table missing');
      assert(await article.locator('ul ul li').textContent() === 'Anidado', 'Nested list missing');
      assert(await article.locator('ol').getAttribute('start') === '3', 'Ordered list start lost');
      assert(await article.locator('input[type=checkbox]:checked').count() === 1, 'Task list missing');
      assert(await article.locator('script,img[onerror],a[href^="javascript:"]').count() === 0, 'Unsafe document HTML became DOM');
      assert(!(await page.evaluate(() => window.markdownExecuted)), 'Markdown executed script');
      await article.locator('img').waitFor();
      assert(await article.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), 'Relative image failed');
      assert((await article.getByText('Otro archivo', { exact: true }).getAttribute('href')).includes('/archivos?'), 'Relative link lost file context');
      const url = page.url(); await article.getByText('Ir a lectura', { exact: true }).click();
      assert(page.url() === url, 'Fragment link changed application route');
      await page.locator('.axon-doc').focus(); await page.keyboard.press('ArrowDown');
      assert(page.url() === url, 'Reading scroll key selected another file');
      await page.getByRole('button', { name: 'Pantalla completa', exact: true }).last().click();
      await page.waitForFunction(() => !!document.fullscreenElement); await page.evaluate(() => document.exitFullscreen());
      const themes = await page.evaluate(() => AxonThemes.presets.map(({ id, mode }) => ({ id, mode })));
      for (const { id, mode } of themes) {
        await page.evaluate(({ id, mode }) => { AxonThemes.setMode(mode); AxonThemes.select(id); }, { id, mode });
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: 1000 });
          const fits = await article.evaluate(el => { const rect = el.getBoundingClientRect(); return rect.x >= 0 && rect.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth; });
          assert(fits, 'Markdown overflow: ' + [section, id, width]);
        }
        const axe = await new AxeBuilder({ page }).include('.axon-doc').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        assert(!axe.violations.length, 'Markdown accessibility ' + [section, id] + ': ' + JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))));
      }
      await page.evaluate(() => { AxonThemes.setMode('dark'); AxonThemes.select('axon'); });
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width < 769) await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
        await page.screenshot({ path: path.join(output, section + '-' + width + '.png') });
      }
      checks.push(section + ': formatted Markdown, safe HTML, images/links, keyboard, fullscreen, all 20 dark/light appearance presets and 320–1440px');
      await open(section, 'guia.markdown'); assert(await page.locator('.axon-markdown table').count() === 1, 'Markdown alias broken');
      await open(section, 'vacio.md'); assert((await page.locator('.axon-markdown').textContent()).includes('vacío'), 'Empty document lacks a state');
      await open(section, 'grande.md'); assert((await page.locator('.axon-doc-footer').textContent()).includes('512 KB'), 'Large document lacks a limit notice');
      checks.push(section + ': alias, empty and limited document states');
    }
    await open('files');
    assert(await page.locator('#fm-editor-text').isHidden(), 'Markdown opened in editor by default');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    const textarea = page.locator('#fm-editor-text');
    const draft = (await textarea.inputValue()) + '\n## Borrador sin guardar\n';
    await textarea.fill(draft); await textarea.evaluate(el => { el.setSelectionRange(5, 15); el.scrollTop = 80; });
    const selection = await textarea.evaluate(el => [el.selectionStart, el.selectionEnd, el.scrollTop]);
    await page.keyboard.press('Control+e');
    await page.locator('.axon-doc[data-rendered=true]').waitFor();
    assert((await page.locator('.axon-markdown').textContent()).includes('Borrador sin guardar'), 'Reader lost unsaved draft');
    assert((await page.locator('.axon-doc-footer').textContent()).includes('sin guardar'), 'Draft not identified');
    assert(await fs.readFile(fixture + '/guia.md', 'utf8') === original, 'Switching views wrote the file');
    await page.keyboard.press('Control+e');
    assert(await textarea.inputValue() === draft, 'Editor lost draft on return');
    assert(JSON.stringify(await textarea.evaluate(el => [el.selectionStart, el.selectionEnd, el.scrollTop])) === JSON.stringify(selection), 'Switch lost editor cursor/scroll');
    await page.getByRole('button', { name: 'Visualizador', exact: true }).click();
    await page.locator('.axon-doc[data-rendered=true]').waitFor();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await page.locator('#confirm-modal[open] #confirm-body').waitFor();
    await page.locator('#confirm-modal').getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert(await textarea.inputValue() === draft, 'Cancel lost unsaved content');
    await page.keyboard.press('Control+s'); await page.locator('.fm-diff-save').click();
    await page.locator('.fm-diff-modal').waitFor({ state: 'detached' });
    assert(await page.locator('#fm-dirty-dot').isHidden(), 'Save left draft dirty');
    const saved = await fs.readFile(fixture + '/guia.md', 'utf8');
    assert(saved.startsWith('\ufeff') && saved.includes('\r\n## Borrador sin guardar\r\n'), 'Save lost original BOM/CRLF');
    await page.reload(); await page.locator('.axon-doc[data-rendered=true]').waitFor();
    assert((await page.locator('.axon-markdown').textContent()).includes('Borrador sin guardar'), 'Reload lost saved content');
    checks.push('Default reading, button/keyboard toggles, cursor/scroll, draft preview, cancel close, Ctrl+S diff save, BOM/CRLF and reload');
    await page.evaluate(url => AxonNavigation.go(url), origin + '/biblioteca?' + new URLSearchParams({ type: 'folder', value: fixture, item: items.find(i => i.n === 'otro.md').id }));
    await page.locator('.axon-doc[data-rendered=true]').waitFor();
    assert(await page.locator('.axon-doc').count() === 1, 'Leaving Files retained a stale reader DOM');
    checks.push('Changing section destroys the previous reader and its DOM');
    await page.goto(filesUrl('guia.md', true)); await textarea.waitFor({ state: 'visible' });
    assert(new URL(page.url()).searchParams.get('edit') === '1', 'Direct editor route broken');
    await page.goto(filesUrl('nota.txt')); await page.locator('.fm-pv-text').waitFor();
    assert(await page.locator('#fm-document-modes').isHidden(), 'Markdown controls leaked into plain text');
    for (const name of ['binario.md', 'invalido.md']) {
      await page.goto(filesUrl(name)); await textarea.waitFor({ state: 'visible' });
      assert(await textarea.getAttribute('readonly') !== null && await page.locator('#fm-save-btn').isDisabled(), 'Invalid UTF-8 became editable');
    }
    checks.push('Direct edit route, plain text preview and binary/invalid UTF-8 read-only preservation');
    let release, intercepted = false;
    await page.route('**/api/files/read?**', async route => {
      if (route.request().url().includes('guia.md')) { intercepted = true; await new Promise(resolve => { release = resolve; }); }
      await route.continue().catch(() => {});
    });
    await page.goto(filesUrl('guia.md')); await page.waitForFunction(() => window.AxonNavigation?.ready);
    for (let i = 0; i < 100 && !intercepted; i++) await page.waitForTimeout(20);
    assert(intercepted, 'Late response fixture failed');
    const next = page.evaluate(url => AxonNavigation.go(url), filesUrl('otro.md'));
    await page.waitForFunction(() => location.search.includes('otro.md'));
    release(); await next; await page.locator('.axon-doc[data-rendered=true]').waitFor();
    assert(await page.locator('.axon-markdown h1').textContent() === 'Otro documento', 'Late response replaced current document');
    await page.unroute('**/api/files/read?**');
    checks.push('Late read cannot replace a newly selected Markdown document');
    assert(!heavy.length, 'Markdown loaded a PDF parser or Office conversion');
    assert(!errors.length, 'Browser errors: ' + errors.join('; '));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, heavy }, null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
  } catch (error) {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: String(error), checks, errors }, null, 2));
    console.error(error); process.exitCode = 1;
  } finally { await browser.close(); if (fixture) await fs.rm(fixture, { recursive: true, force: true }); }
})();
