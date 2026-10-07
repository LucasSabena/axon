import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, stat, utimes, symlink, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DocumentPreviews, documentResponse } from './document-preview';
import { parseDelimited, readTable } from '../public/document-table.js';

let dir: string, previews: DocumentPreviews;
const run = async (args: string[]) => {
  const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code) throw new Error(err || out); return out;
};
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'axon-document-test-'));
  await run(['python3', 'scripts/document-fixtures.py', dir]);
  previews = new DocumentPreviews(path.join(dir, 'cache'));
}, 120000);
afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
async function rendered(name: string) {
  const source = path.join(dir, name); let state = await previews.request(source, true);
  const end = Date.now() + 80000;
  while (!['done', 'error'].includes(state.state) && Date.now() < end) {
    await Bun.sleep(50); state = await previews.request(source);
  }
  return state;
}

test('real Word, PowerPoint and Excel legacy/modern/OpenDocument render all pages and preserve originals', async () => {
  for (const [name, text] of [
    ...['doc', 'docx', 'odt', 'rtf'].map(e => [`lectura.${e}`, 'AXON SEGUNDA PAGINA']),
    ...['ppt', 'pptx', 'odp'].map(e => [`diapositivas.${e}`, 'AXON DIAPOSITIVA 2']),
    ...['xls', 'xlsx', 'ods'].map(e => [`planilla.${e}`, 'AXON DETALLE']),
  ]) {
    const original = await readFile(path.join(dir, name));
    const state = await rendered(name); expect(state.state).toBe('done');
    if (state.kind === 'table') {
      const workbook = JSON.parse(await readFile(state.file!, 'utf8'));
      expect(workbook.sheets.length).toBe(2);
      expect(workbook.sheets[1].rows[0]).toEqual(['AXON DETALLE', '678.9']);
    } else expect(await run(['pdftotext', state.file!, '-'])).toContain(text);
    expect(await readFile(path.join(dir, name))).toEqual(original);
    const cached = await previews.request(path.join(dir, name), true);
    expect(cached.key).toBe(state.key); expect(cached.file).toBe(state.file);
  }
}, 120000);

test('same-size same-mtime rewrites invalidate cache; concurrent opens share one rendition', async () => {
  const file = path.join(dir, 'cambio.rtf');
  await writeFile(file, '{\\rtf1\\ansi AXON VERSION UNO}');
  const initial = await stat(file);
  const [a, b] = await Promise.all([previews.request(file, true), previews.request(file, true)]);
  expect(a.key).toBe(b.key); const old = await rendered('cambio.rtf'); expect(old.state).toBe('done');
  await writeFile(file, '{\\rtf1\\ansi AXON VERSION DOS}'); await utimes(file, initial.atime, initial.mtime);
  const changed = await previews.request(file); expect(changed.key).not.toBe(old.key); expect(changed.state).toBe('none');
  const next = await rendered('cambio.rtf'); expect(await run(['pdftotext', next.file!, '-'])).toContain('VERSION DOS');
}, 30000);

test('non-regular, empty, oversized and unsupported inputs fail explicitly; corrupted Office files do not report success', async () => {
  await symlink(path.join(dir, 'lectura.docx'), path.join(dir, 'link.docx'));
  const huge = await open(path.join(dir, 'grande.docx'), 'w'); await huge.truncate(101 * 1024 * 1024); await huge.close();
  for (const name of ['link.docx', 'vacio.xlsx', 'grande.docx', 'tabla.csv']) {
    await expect(previews.request(path.join(dir, name), true)).rejects.toThrow();
  }
  expect((await rendered('dañado.docx')).state).toBe('error');
}, 90000);

test('rendition URLs cannot serve a different source revision', async () => {
  const file = path.join(dir, 'ruta.rtf'); await writeFile(file, '{\\rtf1 AXON URL}');
  const base = 'http://localhost/api/files/document?path=' + encodeURIComponent(file);
  let r = await documentResponse(file, new Request(base, { method: 'POST' }), base), state = await r.json();
  const deadline = Date.now() + 15000;
  while (state.state !== 'done' && Date.now() < deadline) { await Bun.sleep(50); r = await documentResponse(file, new Request(base), base); state = await r.json(); }
  expect(state.state).toBe('done');
  r = await documentResponse(file, new Request('http://localhost' + state.url), base);
  expect(r.headers.get('content-type')).toBe('application/pdf'); expect(r.headers.get('cache-control')).toBe('private, no-store');
  await writeFile(file, '{\\rtf1 AXON NEW}');
  expect((await documentResponse(file, new Request('http://localhost' + state.url), base)).status).toBe(409);
}, 30000);

test('CSV handles semicolons, quoted commas/newlines, BOM, escaped quotes, XSS and explicit row/column limits', () => {
  const data = parseDelimited('\uFEFFNombre;Precio;Nota\r\nPeña;123,45;"dos\nlíneas"\r\n"<script>";0;"doble ""comilla"""\r\n');
  expect(data.separator).toBe(';'); expect(data.rows[1]).toEqual(['Peña', '123,45', 'dos\nlíneas']);
  expect(data.rows[2]).toEqual(['<script>', '0', 'doble "comilla"']); expect(data.truncated).toBe(false);
  expect(parseDelimited('A;B;C\n123,45;234,56;345,67\n123,45;234,56;345,67').rows[1]).toEqual(['123,45', '234,56', '345,67']);
  expect(parseDelimited('A\tB\n1\t2', '\t').rows).toEqual([['A', 'B'], ['1', '2']]);
  expect(parseDelimited(Array(101).fill('x').join(',')).rows[0].length).toBe(100);
  expect(parseDelimited(Array(101).fill('x').join(',')).truncated).toBe(true);
  const limit = parseDelimited('x\n'.repeat(10001)); expect(limit.rows.length).toBe(10000); expect(limit.truncated).toBe(true);
  expect(() => parseDelimited('"sin cerrar')).toThrow();
});

test('CSV decoder supports legacy encodings and enforces byte limits while streaming', async () => {
  const signal = new AbortController().signal;
  expect((await readTable(new Response(new Uint8Array([80, 101, 241, 97])), signal)).text).toBe('Peña');
  expect((await readTable(new Response(new Uint8Array([255, 254, 65, 0, 9, 0, 66, 0])), signal)).text).toBe('A\tB');
  await expect(readTable(new Response(new Uint8Array(5 * 1024 * 1024 + 1)), signal)).rejects.toThrow('5 MB');
});

test('conversion sandbox cannot read host credentials, inherits no app secret and has a private network', async () => {
  await writeFile(path.join(dir, 'private-secret'), 'fixture-secret-to-isolate');
  await writeFile(path.join(dir, 'sandbox-test.py'), `import os,socket\nassert 'AXON_TEST_SECRET' not in os.environ\nassert not os.path.exists('${dir}/private-secret')\nassert not os.path.exists('/hostfs')\ns=socket.socket();s.settimeout(1)\ntry: s.connect(('1.1.1.1',443)); raise AssertionError('network reachable')\nexcept OSError: pass\nprint('isolated')\n`);
  expect(await run(['python3', '-c', `import runpy,pathlib,subprocess,os; os.environ['AXON_TEST_SECRET']='fixture-only-secret'; m=runpy.run_path('src/document-convert.py'); p=subprocess.run(m['sandbox_command'](pathlib.Path('${dir}'),['python3','/work/sandbox-test.py']),capture_output=True,text=True); print(p.stdout); assert p.returncode==0,p.stderr`])).toContain('isolated');
});
