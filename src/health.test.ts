import { test, expect } from 'bun:test';
import { appLabel, cacheRule, growthBetween, isProtected, niceRuleFor, parseDockerDf, parseSize, walRule, DEFAULT_NICE_RULES, staticRules, type RawProc } from './health-rules';
import { validPath } from './health';

const proc = (over: Partial<RawProc>): RawProc => ({ pid: 500, ppid: 1, uid: 1000, user: 'binary', nice: 0, state: 'S', ticks: 0, start: 1, rss: 0, threads: 1, kernel: false, args: '/usr/bin/foo', ...over });

test('parseSize y docker df', () => {
  expect(parseSize('1.5GB (45%)')).toBe(1.5e9);
  expect(parseSize('0B')).toBe(0);
  expect(parseDockerDf('Images|2GB (50%)\nBuild Cache|500MB\n')).toEqual({ Images: 2e9, 'Build Cache': 5e8 });
});

test('las reglas no aceptan nombres peligrosos', () => {
  expect(cacheRule('/home/u', '../etc', 1)).toBeNull();
  expect(cacheRule('/home/u', 'keyrings', 1)).toBeNull();
  expect(cacheRule('/home/u', 'pnpm', 1)).toBeNull();
  expect(cacheRule('/home/u', 'hyperframes', 1)?.clean).toBe(`rm -rf '/home/u/.cache/hyperframes'`);
  expect(walRule('/home/u/x/opencode.db-wal')?.clean).toContain('wal_checkpoint');
  expect(walRule("/home/u/x'; rm -rf ~ #-wal")).toBeNull();
  expect(walRule('/home/u/../etc/passwd-wal')).toBeNull();
});

test('las reglas seguras sólo apuntan a rutas esperadas', () => {
  const rules = staticRules('/home/u', 'u');
  for (const r of rules.filter(r => r.risk === 'safe')) expect(r.clean).not.toMatch(/rm -rf \/(\s|$)/);
  expect(rules.find(r => r.id === 'trash-axon')?.risk).toBe('review');
});

test('procesos protegidos y agrupación', () => {
  expect(isProtected(proc({ args: '/usr/sbin/sshd -D' }), 1000, new Set())).toBeTruthy();
  expect(isProtected(proc({ uid: 0 }), 1000, new Set())).toBeTruthy();
  expect(isProtected(proc({ pid: 77 }), 1000, new Set([77]))).toBeTruthy();
  expect(isProtected(proc({ args: '/usr/bin/ffmpeg -i a.mp4' }), 1000, new Set())).toBeNull();
  expect(appLabel('/opt/google/chrome/chrome --user-data-dir=/home/u/.config/navegador-chrome')).toBe('Chrome (navegador-chrome)');
  expect(appLabel('bun run src/index.ts')).toBe('bun src/index.ts');
});

test('prioridad automática por coincidencia', () => {
  expect(niceRuleFor('/usr/bin/ffmpeg -i x', DEFAULT_NICE_RULES)?.id).toBe('encoders');
  expect(niceRuleFor('/usr/bin/firefox', DEFAULT_NICE_RULES)).toBeNull();
});

test('crecimiento esconde el ancestro explicado por un hijo', () => {
  const prev = { '/home/u': 10e9, '/home/u/.local': 8e9, '/home/u/.local/share/opencode': 4e9 };
  const next = { '/home/u': 16e9, '/home/u/.local': 14e9, '/home/u/.local/share/opencode': 10e9, '/home/u/doc': 0.2e9 };
  const g = growthBetween(prev, next);
  expect(g.map(x => x.path)).toEqual(['/home/u/.local/share/opencode', '/home/u/doc']);
});

test('validPath', () => {
  expect(validPath('/home/u/')).toBe('/home/u');
  expect(() => validPath('/home/u/../etc')).toThrow();
  expect(() => validPath('relativa')).toThrow();
  expect(() => validPath('/proc/1')).toThrow();
});
