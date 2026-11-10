import { test, expect } from 'bun:test';
import {
  applyPortPrefPatch,
  groupPrefKey,
  isValidPortPrefKey,
  normalizePortPrefs,
  portPrefKey,
  resolvePortPrefs,
  type PortPrefs,
} from './port-prefs';

test('port and group keys are validated', () => {
  expect(isValidPortPrefKey(portPrefKey(5800))).toBe(true);
  expect(isValidPortPrefKey(portPrefKey(65535))).toBe(true);
  expect(isValidPortPrefKey('port:0')).toBe(false);
  expect(isValidPortPrefKey('port:65536')).toBe(false);
  expect(isValidPortPrefKey('port:080')).toBe(false);
  expect(isValidPortPrefKey(groupPrefKey('/home/binary/server-stack/axon'))).toBe(true);
  expect(isValidPortPrefKey('group:relative')).toBe(false);
  expect(isValidPortPrefKey('group:/bad\npath')).toBe(false);
  expect(isValidPortPrefKey('disk:/x')).toBe(false);
});

test('a process is hidden only when every one of its ports is hidden', () => {
  const prefs: PortPrefs = {
    'port:5800': { hidden: true, label: 'Navegador' },
    'port:5801': { hidden: true },
    'port:3000': { protected: true },
  };
  expect(resolvePortPrefs(prefs, [5800, 5801])).toEqual({
    label: 'Navegador', hidden: true, hiddenPorts: [5800, 5801], protected: false,
  });
  expect(resolvePortPrefs(prefs, [5801, 5800, 3000])).toEqual({
    label: 'Navegador', hidden: false, hiddenPorts: [5800, 5801], protected: true,
  });
  expect(resolvePortPrefs(prefs, [3000]).label).toBeUndefined();
  expect(resolvePortPrefs(prefs, [])).toEqual({ hidden: false, hiddenPorts: [], protected: false });
});

test('label uses the lowest named port and ignores unknown ports', () => {
  const prefs: PortPrefs = {
    'port:9000': { label: 'Alto' },
    'port:8000': { label: 'Bajo' },
  };
  expect(resolvePortPrefs(prefs, [9000, 8000]).label).toBe('Bajo');
  expect(resolvePortPrefs(prefs, [9999]).label).toBeUndefined();
});

test('a patch trims labels and removes cleared fields', () => {
  let prefs: PortPrefs = {};
  prefs = applyPortPrefPatch(prefs, 'port:5800', { label: '  Navegador  ', hidden: true });
  expect(prefs).toEqual({ 'port:5800': { label: 'Navegador', hidden: true } });
  prefs = applyPortPrefPatch(prefs, 'port:5800', { hidden: false });
  expect(prefs).toEqual({ 'port:5800': { label: 'Navegador' } });
  prefs = applyPortPrefPatch(prefs, 'port:5800', { label: '' });
  expect(prefs).toEqual({});
  prefs = applyPortPrefPatch(prefs, 'port:5800', { protected: true });
  prefs = applyPortPrefPatch(prefs, 'port:5800', { protected: false });
  expect(prefs).toEqual({});
});

test('invalid patches are rejected', () => {
  expect(() => applyPortPrefPatch({}, 'port:0', { hidden: true })).toThrow('inválida');
  expect(() => applyPortPrefPatch({}, 'port:5800', { label: 'x'.repeat(65) })).toThrow('64');
  expect(() => applyPortPrefPatch({}, 'port:5800', { label: 'dos\nlíneas' })).toThrow('64');
  // @ts-expect-error runtime guard for untyped JSON bodies
  expect(() => applyPortPrefPatch({}, 'port:5800', { hidden: 'yes' })).toThrow('hidden');
});

test('malformed stored entries are dropped without losing valid ones', () => {
  const prefs = normalizePortPrefs({
    'port:5800': { label: '  Navegador ', hidden: true },
    'port:99999': { hidden: true },
    'group:/srv/app': { protected: true, noise: 'x' },
    'group:relative': { hidden: true },
    'port:3000': { label: '' },
    'port:3001': null,
  });
  expect(prefs).toEqual({
    'port:5800': { label: 'Navegador', hidden: true },
    'group:/srv/app': { protected: true },
  });
  expect(normalizePortPrefs('broken')).toEqual({});
});
