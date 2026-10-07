// The production bundle inlines every module into dist/index.js, so every
// `new URL('./x.py', import.meta.url)` — no matter which source file
// declared it — resolves relative to dist/ at runtime. A missing copy is a
// runtime ENOENT only in prod. This script verifies coverage two ways:
//
//   1. Static (always): every in-dist reference must be produced by a `cp`
//      in the package.json "build" script; references that escape dist/
//      (e.g. `../scripts/agent-*.py`) must exist on disk; `new URL` worker
//      entrypoints (*.ts) are re-emitted by the bundler, so they are checked
//      against the referencing source file's directory instead.
//   2. Post-build (when dist/ exists): every reference must existSync.
//
// Test files are excluded: they run from src/, where import.meta.url still
// points at the real source tree.
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
// After `bun build src/index.ts --outdir dist`, import.meta.url is
// dist/index.js for every inlined module.
const bundleDir = path.join(root, 'dist');
const urlPattern = /new URL\(\s*['"`]([^'"`]+)['"`]\s*,\s*import\.meta\.url\s*\)/g;
const cpPattern = /\bcp\s+([^\s&|]+)\s+([^\s&|]+)/g;

const pkg = JSON.parse(await Bun.file('package.json').text());
const buildScript: string = pkg.scripts?.build ?? '';
const copies = new Map<string, string>(); // dist-relative dst → src source
for (const m of buildScript.matchAll(cpPattern)) {
  const [, src, dst] = m;
  copies.set(path.normalize(dst), path.normalize(src));
  if (!existsSync(path.join(root, src)))
    fail(`build script copies missing source: ${src}`);
}

function fail(msg: string): never {
  console.error(`check-dist: ${msg}`);
  process.exit(1);
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield full;
  }
}

const missing: string[] = [];
const probed: string[] = [];
const produced = new Set(copies.keys());
const consumed = new Set<string>();
const built = existsSync(path.join(bundleDir, 'index.js'));
let checked = 0;

const nonLiteral: string[] = [];

for await (const file of walk(path.join(root, 'src'))) {
  const source = await Bun.file(file).text();
  // Second guard: import.meta.url uses NOT shaped as new URL('literal', …)
  // resolve dynamically at runtime — this check can't verify them, so they
  // hard-fail the build. Rewrite the site as new URL('literal', import.meta.url)
  // (that's the only shape bun build rewrites) to pass.
  for (const m of source.matchAll(/import\.meta\.url/g)) {
    const window = source.slice(Math.max(0, m.index - 120), m.index);
    if (!/new URL\(\s*['"`][^'"`]+['"`]\s*,\s*$/.test(window)) {
      nonLiteral.push(`${path.relative(root, file)}:${source.slice(0, m.index).split('\n').length} — import.meta.url fuera de new URL('literal', …)`);
    }
  }
  for (const match of source.matchAll(urlPattern)) {
    const specifier = match[1];
    // Scheme-qualified ('https://…', 'file:…') or host-relative ('//host')
    // specifiers ignore import.meta.url entirely — never a dist asset.
    if (/^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(specifier)) continue;
    // `new Worker(new URL('./x.ts', import.meta.url))` specifiers are NOT
    // rewritten by `bun build` (verified: the specifier survives verbatim in
    // dist/index.js). The worker file must therefore exist BOTH relative to
    // this source file (dev mode) and as a copied file inside dist/ (prod).
    if (/\.tsx?$/.test(specifier)) {
      checked++;
      const sourceResolved = path.resolve(path.dirname(file), specifier);
      if (!existsSync(sourceResolved))
        missing.push(`${path.relative(root, file)} → '${specifier}' (worker entry not found: ${path.relative(root, sourceResolved)})`);
      const rel = path.normalize(path.relative(root, path.resolve(bundleDir, specifier)));
      consumed.add(rel);
      // Require a cp entry even when dist/ exists: stale leftovers from
      // previous builds must not mask a copy that was removed.
      const ok = produced.has(rel) && (!built || existsSync(path.join(root, rel)));
      if (!ok) missing.push(`${path.relative(root, file)} → '${specifier}' (${rel} ${produced.has(rel) ? 'missing in dist/' : 'has no cp in build script'})`);
      continue;
    }
    const resolved = path.resolve(bundleDir, specifier);
    const insideDist = resolved.startsWith(bundleDir + path.sep);
    checked++;
    if (insideDist) {
      const rel = path.normalize(path.relative(root, resolved));
      consumed.add(rel);
      const ok = produced.has(rel) && (!built || existsSync(resolved));
      if (!ok) {
        // existsSync probes intentionally check a pre-bundle location first
        // and fall back to the dist copy (e.g. src/cloud/downloads.ts); the
        // fallback reference is itself validated by this scan.
        const guarded = /existsSync\(/.test(source.slice(match.index, match.index + 400));
        (guarded ? probed : missing).push(`${path.relative(root, file)} → '${specifier}' (${rel} ${built ? 'missing in dist/' : 'has no cp in build script'})`);
      }
    } else if (!existsSync(resolved)) {
      const guarded = /existsSync\(/.test(source.slice(match.index, match.index + 400));
      (guarded ? probed : missing).push(`${path.relative(root, file)} → '${specifier}' (${path.relative(root, resolved)} does not exist)`);
    }
  }
}

for (const p of probed) console.log(`  probe with existsSync fallback: ${p}`);
if (nonLiteral.length) {
  console.error(`\ncheck-dist: ${nonLiteral.length} import.meta.url use(s) this check cannot verify:`);
  for (const m of nonLiteral) console.error(`  ${m}`);
  console.error('\nFix: use new URL(\'./literal\', import.meta.url) so the asset can be copied into dist/.');
  process.exit(1);
}
// Runtime truth: scan the actual bundle for literal import.meta references
// the source-side scan could have missed (e.g. through a shared helper).
if (built) {
  const bundle = await Bun.file(path.join(bundleDir, 'index.js')).text();
  const bundleMisses: string[] = [];
  for (const match of bundle.matchAll(urlPattern)) {
    if (/^([a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/.test(match[1])) continue;
    const resolved = path.resolve(bundleDir, match[1]);
    if (resolved.startsWith(bundleDir + path.sep) && !existsSync(resolved)) bundleMisses.push(`dist/index.js → '${match[1]}'`);
  }
  if (bundleMisses.length) {
    console.error(`\ncheck-dist: ${bundleMisses.length} reference(s) inside the bundle resolve to missing files:`);
    for (const m of bundleMisses) console.error(`  ${m}`);
    process.exit(1);
  }
}
const orphans = [...produced].filter(dst => !consumed.has(dst));
for (const o of orphans) console.log(`  copied but unreferenced: ${o} (from ${copies.get(o)})`);
if (missing.length) {
  console.error(`\ncheck-dist: ${missing.length} asset reference(s) unresolved:`);
  for (const m of missing) console.error(`  ${m}`);
  console.error('\nFix: add the matching `cp` to the "build" script in package.json.');
  process.exit(1);
}
console.log(`dist asset check OK: ${checked} import.meta.url references, ${produced.size} build copies (${built ? 'verified against dist/' : 'verified against build cp list'})`);
