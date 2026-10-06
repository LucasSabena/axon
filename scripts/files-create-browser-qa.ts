import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSession } from '../src/auth';

const entry = process.env.AXON_QA_PLAYWRIGHT_ENTRY;
if (!entry) throw new Error('Set AXON_QA_PLAYWRIGHT_ENTRY to an installed Playwright CLI entrypoint');
const { chromium } = createRequire(await realpath(entry))('playwright');
const origin = process.env.AXON_QA_ORIGIN || 'http://127.0.0.1:3459';
const production = new URL(origin).hostname !== '127.0.0.1';
const dir = await mkdtemp((process.env.AXON_QA_FIXTURE_HOME || tmpdir()) + '/axon-create-browser-');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const outcomes: string[] = [], errors: string[] = [];
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
try {
  await mkdir(dir + '/nested'); await writeFile(dir + '/existing.txt', 'preservar');
  await writeFile(dir + '/binary.abc', Buffer.from([65, 0xff, 0, 66]));
  await writeFile(dir + '/windows.env', '\uFEFFNOMBRE=original\r\n');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (production) {
    const config = await Bun.file('data/config.json').json();
    await context.addCookies([{ name: 'axon_session', value: await createSession(config.auth.username), url: origin, httpOnly: true, secure: true, sameSite: 'Lax' }]);
  }
  const page = await context.newPage(); page.on('pageerror', (e: Error) => errors.push(e.message));
  let hidden = '0';
  const location = (folder = dir, item?: string, edit = false) => origin + '/archivos?' + new URLSearchParams({ path: folder, view: 'list', hidden, ...(item ? { item, ...(edit ? { edit: '1' } : {}) } : {}) });
  await page.goto(location());
  if (!production) {
    await page.locator('#username').fill('qa'); await page.locator('#password').fill('axon-local-qa'); await page.locator('#login-form button[type=submit]').click();
  }
  await page.locator('#tab-files.active').waitFor();
  await page.locator('.fm-row[data-name="existing.txt"]').waitFor();
  const list = async (folder = dir) => {
    await page.evaluate((url: string) => (window as any).AxonNavigation.go(url), location(folder));
    await page.locator('#fm-main:not(.hidden)').waitFor();
  };
  const create = async (name: string) => {
    await page.locator('#fm-new-file-btn').click(); await page.locator('#fm-create-name').fill(name);
    await page.locator('.fm-create-submit').click(); await page.locator('#fm-editor:not(.hidden)').waitFor();
    assert((await page.locator('#fm-editor-name').textContent()).endsWith('/' + name), 'Wrong created editor');
  };
  const save = async (content: string) => {
    await page.locator('#fm-editor-text').fill(content); await page.keyboard.press('Control+s');
    await page.locator('.fm-diff-save').click(); await page.locator('.fm-diff-modal').waitFor({ state: 'detached' });
    assert(await page.locator('#fm-dirty-dot').isHidden(), 'Saved file remains dirty');
  };

  await page.locator('#fm-new-file-btn').click(); await page.locator('[data-name=".env"]').click();
  assert(await page.locator('#fm-create-name').inputValue() === '.env', 'Env preset missing');
  await page.route('**/api/files/create', async (route: any) => { await new Promise(r => setTimeout(r, 700)); await route.continue(); });
  await page.locator('.fm-create-submit').click();
  assert(await page.locator('.fm-create-submit').isDisabled(), 'Create can be duplicated');
  assert(await page.locator('.fm-create-submit').getAttribute('aria-busy') === 'true', 'Creation lacks feedback');
  await page.locator('#fm-editor:not(.hidden)').waitFor(); await page.unroute('**/api/files/create');
  assert(new URL(page.url()).searchParams.get('hidden') === '1', 'Dotfile creation must reveal hidden files'); hidden = '1';
  await save('NOMBRE=Prueba\nCLAVE=fixture-sin-secretos\n');
  assert(await readFile(dir + '/.env', 'utf8') === 'NOMBRE=Prueba\nCLAVE=fixture-sin-secretos\n', 'Env content not persisted');
  await page.reload(); await page.locator('#fm-editor:not(.hidden)').waitFor();
  assert((await page.locator('#fm-editor-text').inputValue()).includes('CLAVE=fixture-sin-secretos'), 'Env reload lost content');
  await list();
  assert(await page.locator('.fm-row[data-name=".env"]').isVisible(), 'Created hidden file disappeared');
  await page.locator('.fm-row[data-name=".env"]').click({ button: 'right' });
  await page.locator('#ctx-menu').getByText('Vista previa', { exact: true }).click();
  await page.locator('.fm-pv-text').waitFor(); assert((await page.locator('.fm-pv-text').textContent()).includes('NOMBRE=Prueba'), 'Text preview is broken');
  outcomes.push('Env creation, busy state, editing, Ctrl+S, reload, hidden visibility and text preview');

  await page.locator('#fm-new-file-btn').click(); await page.locator('#fm-create-name').fill('existing.txt');
  await page.locator('.fm-create-submit').click(); await page.locator('#fm-create-error:not(.hidden)').waitFor();
  assert((await page.locator('#fm-create-error').textContent()).includes('Ya existe'), 'Duplicate needs an inline error');
  assert(await readFile(dir + '/existing.txt', 'utf8') === 'preservar', 'Duplicate overwrote original');
  await page.locator('#fm-create-name').fill('../escape'); await page.locator('.fm-create-submit').click();
  assert((await page.locator('#fm-create-error').textContent()).includes('sin barras'), 'Invalid name accepted');
  await page.keyboard.press('Escape'); await page.locator('.fm-create-modal').waitFor({ state: 'detached' });
  outcomes.push('Duplicate, invalid name and Escape retain the original');

  await create('notas.txt'); await save('Hola desde Archivos\n'); await list();
  await create('personalizado.abc'); await save('Texto con extensión propia\n'); await list();
  await page.locator('.fm-row[data-name="personalizado.abc"]').click({ button: 'right' });
  await page.locator('#ctx-menu').getByText('Editar', { exact: true }).click();
  await page.locator('#fm-editor:not(.hidden)').waitFor();
  assert(await page.locator('#fm-editor-text').inputValue() === 'Texto con extensión propia\n', 'Custom extension cannot be reopened');
  await page.locator('#fm-editor-text').fill('Cambios pendientes\n'); await page.locator('#fm-new-file-btn').click();
  await page.locator('#confirm-modal[open] #confirm-body').waitFor(); await page.keyboard.press('Escape');
  assert(await page.locator('.fm-create-modal').count() === 0, 'Creating discarded unsaved content');
  assert(await page.locator('#fm-editor-text').inputValue() === 'Cambios pendientes\n', 'Dirty content lost');
  await page.route('**/api/files/write', (route: any) => route.fulfill({ status: 503, json: { ok: false, error: 'Fallo temporal de QA' } }));
  await page.locator('#fm-save-btn').click();
  await Promise.all([page.waitForResponse((r: any) => r.url().endsWith('/api/files/write') && r.status() === 503), page.locator('.fm-diff-save').click()]);
  await page.locator('.fm-diff-save:not([disabled])').waitFor();
  assert(await page.locator('.fm-diff-modal').isVisible(), 'Failed save closed the review');
  assert(await page.locator('#fm-dirty-dot').isVisible(), 'Failed save lost dirty state');
  assert(await readFile(dir + '/personalizado.abc', 'utf8') === 'Texto con extensión propia\n', 'Failed save changed the original');
  await page.unroute('**/api/files/write'); await page.locator('.fm-diff-save').click();
  await page.locator('.fm-diff-modal').waitFor({ state: 'detached' }); await list();
  outcomes.push('Text and custom extensions, reopen, dirty guard and save failure/retry');

  await page.locator('.fm-row[data-name="nested"]').click({ button: 'right' });
  await page.locator('#ctx-menu').getByText('Nuevo archivo en esta carpeta', { exact: true }).click();
  await page.locator('#fm-create-name').fill('.env.local'); await page.locator('.fm-create-submit').click();
  await page.locator('#fm-editor:not(.hidden)').waitFor(); await save('ENTORNO=local\n');
  assert(await readFile(dir + '/nested/.env.local', 'utf8') === 'ENTORNO=local\n', 'Folder context used the wrong directory');
  await list(dir + '/nested'); await page.locator('#fm-main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Alt+n'); await page.locator('#fm-create-name').waitFor();
  await page.locator('#fm-create-name').fill('sin-extension'); await page.locator('.fm-create-submit').click();
  await page.locator('#fm-editor:not(.hidden)').waitFor(); await save('Sin extensión\n'); await list();
  await page.locator('#fm-list').click({ button: 'right', position: { x: 3, y: 3 } });
  await page.locator('#ctx-menu').getByText('Nuevo archivo', { exact: true }).click();
  await page.keyboard.press('Escape'); await page.locator('.fm-create-modal').waitFor({ state: 'detached' });
  outcomes.push('Folder and empty-space context menus, keyboard shortcut, extensionless files');

  await page.evaluate((url: string) => (window as any).AxonNavigation.go(url), location(dir, 'windows.env', true));
  await page.locator('#fm-editor:not(.hidden)').waitFor();
  assert(await page.locator('#fm-dirty-dot').isHidden(), 'CRLF file looks modified before editing');
  await save('\uFEFFNOMBRE=editado\n');
  assert(await readFile(dir + '/windows.env', 'utf8') === '\uFEFFNOMBRE=editado\r\n', 'CRLF or BOM lost');
  await page.evaluate((url: string) => (window as any).AxonNavigation.go(url), location(dir, 'binary.abc', true));
  await page.locator('#fm-editor:not(.hidden)').waitFor();
  assert(await page.locator('#fm-save-btn').isDisabled(), 'Binary file can be corrupted by text save');
  assert(await page.locator('#fm-editor-text').getAttribute('readonly') !== null, 'Binary textarea is writable');
  await list(); outcomes.push('CRLF/BOM preserved and binary editing blocked');

  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#fm-new-file-btn').click();
  const box = await page.locator('.fm-create-form').boundingBox();
  assert(box && box.x >= 0 && box.x + box.width <= 390, 'Mobile dialog overflows');
  await page.screenshot({ path: '/tmp/axon-create-file-' + (production ? 'production' : 'local') + '.png', fullPage: true });
  await page.locator('.fm-create-cancel').click(); await page.locator('.fm-create-modal').waitFor({ state: 'detached' });
  assert(errors.length === 0, 'Browser errors: ' + errors.join('; '));
  outcomes.push('Responsive mobile dialog and no unexpected JavaScript errors');
  console.log(JSON.stringify({ origin, passed: true, outcomes, browserErrors: errors.length, temporaryFilesRemoved: true }));
} finally {
  await browser.close(); await rm(dir, { recursive: true, force: true });
}
