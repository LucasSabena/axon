import { describe, expect, test } from 'bun:test';
import { diffLines, planAllowedHosts } from './domain-host-check';

const host = '.example.com';
const config = (body: string) => `import { defineConfig } from 'vite'\n\nexport default defineConfig({\n${body}\n})\n`;

describe('allowedHosts planner', () => {
  test('adds the block when the config has none', () => {
    const text = config("  base: './',\n  server: { port: 5390 },");
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.allowed).toBe(false);
    expect(plan.autoFixable).toBe(true);
    expect(plan.patched).toContain(`preview: { allowedHosts: ['${host}'] },`);
    // still valid: the new property lands inside defineConfig's object
    expect(plan.patched!.trimEnd().endsWith('})')).toBe(true);
    expect(plan.changes).toEqual([{ key: 'preview.allowedHosts', value: `['${host}']` }]);
  });

  test('adds the key inside an existing single-line block', () => {
    const text = config("  preview: { port: 5391 },");
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.patched).toContain(`preview: { allowedHosts: ['${host}'], port: 5391 },`);
  });

  test('appends to an existing single-line array', () => {
    const text = config("  preview: { allowedHosts: ['build.local'] },");
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.patched).toContain(`allowedHosts: ['build.local', '${host}']`);
    expect(plan.changes[0].value).toBe(`['build.local', '${host}']`);
  });

  test('appends on its own line in a multi-line array', () => {
    const text = config("  server: {\n    allowedHosts: [\n      'a.local'\n    ],\n  },");
    const plan = planAllowedHosts(text, { key: 'server', host });
    expect(plan.patched).toContain("      'a.local',\n      '.example.com'");
  });

  test('replaces allowedHosts: false', () => {
    const text = config("  preview: { allowedHosts: false },");
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.patched).toContain(`allowedHosts: ['${host}']`);
  });

  test('no change when the host is already allowed', () => {
    expect(planAllowedHosts(config(`  preview: { allowedHosts: ['${host}'] },`), { key: 'preview', host }).allowed).toBe(true);
    expect(planAllowedHosts(config("  preview: { allowedHosts: true },"), { key: 'preview', host }).allowed).toBe(true);
  });

  test('a dot-entry covers subdomains', () => {
    const plan = planAllowedHosts(config("  preview: { allowedHosts: ['.example.com'] },"), {
      key: 'preview', host: 'app.customer.example.com',
    });
    expect(plan.allowed).toBe(true);
  });

  test('a bare entry does not cover subdomains', () => {
    const plan = planAllowedHosts(config("  preview: { allowedHosts: ['example.com'] },"), {
      key: 'preview', host: 'app.example.com',
    });
    expect(plan.allowed).toBe(false);
  });

  test('server and preview are independent', () => {
    const text = config(`  server: { allowedHosts: ['${host}'] },`);
    expect(planAllowedHosts(text, { key: 'server', host }).allowed).toBe(true);
    expect(planAllowedHosts(text, { key: 'preview', host }).allowed).toBe(false);
  });

  test('comments and strings do not confuse the scanner', () => {
    const text = config("  // preview: { allowedHosts: ['x'] },\n  preview: { port: 5391 },");
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.patched).toContain(`preview: { allowedHosts: ['${host}'], port: 5391 },`);
    expect(plan.patched).toContain("// preview: { allowedHosts: ['x'] },");
  });

  test('a computed allowedHosts is reported, not guessed', () => {
    const plan = planAllowedHosts(config('  preview: { allowedHosts: hosts },'), { key: 'preview', host });
    expect(plan.allowed).toBe(false);
    expect(plan.autoFixable).toBe(false);
    expect(plan.note).toContain('allowedHosts');
  });

  test('shorthand property backed by a module constant', () => {
    const text = `const allowedHosts = ['${host}']\n\nexport default defineConfig({\n  preview: { port: 5391, allowedHosts },\n})\n`;
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.allowed).toBe(true);
    expect(plan.autoFixable).toBe(true);
  });

  test('a constant that misses the host is edited where it is defined', () => {
    const text = `const allowedHosts = ['build.local']\n\nexport default defineConfig({\n  preview: { port: 5391, allowedHosts },\n})\n`;
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.autoFixable).toBe(true);
    expect(plan.patched).toContain(`const allowedHosts = ['build.local', '${host}']`);
    expect(plan.changes[0].key).toBe('allowedHosts');
  });

  test('an imported constant stays manual', () => {
    const text = config('  preview: { allowedHosts: sharedList },');
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.autoFixable).toBe(false);
    expect(plan.note).toContain('sharedList');
  });

  test('a function-form config is not rewritten blindly', () => {
    const text = "export default defineConfig(({ mode }) => ({\n  preview: { port: 5391 },\n}))\n";
    const plan = planAllowedHosts(text, { key: 'preview', host });
    expect(plan.autoFixable).toBe(false);
  });
});

describe('other frameworks', () => {
  test('Astro: server.allowedHosts lands at the end of defineConfig', () => {
    const text = "import { defineConfig } from 'astro/config';\n\nexport default defineConfig({\n  site: SITE,\n  output: 'static',\n  prefetch: { prefetchAll: true },\n});\n";
    const plan = planAllowedHosts(text, { path: ['server'], host });
    expect(plan.patched).toContain("  prefetch: { prefetchAll: true },\n  server: { allowedHosts: ['.example.com'] },\n});");
  });

  test('Nuxt: creates vite.server.allowedHosts when vite is missing', () => {
    const text = "export default defineNuxtConfig({\n  devtools: { enabled: true }\n})\n";
    const plan = planAllowedHosts(text, { path: ['vite', 'server'], host });
    expect(plan.patched).toContain("  devtools: { enabled: true },\n  vite: { server: { allowedHosts: ['.example.com'] } },\n})");
    expect(plan.changes[0].key).toBe('vite.server.allowedHosts');
  });

  test('Nuxt: fills an existing vite block', () => {
    const text = "export default defineNuxtConfig({\n  vite: {\n    plugins: [],\n  },\n})\n";
    const plan = planAllowedHosts(text, { path: ['vite', 'server'], host });
    expect(plan.patched).toContain("  vite: {\n    server: { allowedHosts: ['.example.com'] },\n    plugins: [],");
  });

  test('Next: named config object, wrapped export', () => {
    const text = "import type { NextConfig } from 'next'\n\nconst nextConfig: NextConfig = {\n  reactStrictMode: true,\n}\n\nexport default withMDX(nextConfig)\n";
    const plan = planAllowedHosts(text, { path: [], prop: 'allowedDevOrigins', host: '*.example.com' });
    expect(plan.patched).toContain("  reactStrictMode: true,\n  allowedDevOrigins: ['*.example.com'],\n}");
  });

  test('Next: module.exports literal and wildcard coverage', () => {
    const text = "module.exports = {\n  allowedDevOrigins: ['*.example.com'],\n}\n";
    expect(planAllowedHosts(text, { path: [], prop: 'allowedDevOrigins', host: '*.example.com' }).allowed).toBe(true);
    expect(planAllowedHosts(text, { path: [], prop: 'allowedDevOrigins', host: '*.app.example.com' }).allowed).toBe(true);
  });

  test('an opaque block is left for the user', () => {
    const plan = planAllowedHosts(config('  server: serverOptions,'), { path: ['server'], host });
    expect(plan.autoFixable).toBe(false);
  });

  test('diff shows the added line with context', () => {
    const before = 'a\nb\nc\n';
    const after = 'a\nb\nX\nc\n';
    expect(diffLines(before, after)).toEqual([
      { kind: ' ', line: 2, text: 'b' },
      { kind: '+', line: 3, text: 'X' },
      { kind: ' ', line: 4, text: 'c' },
    ]);
  });
});
