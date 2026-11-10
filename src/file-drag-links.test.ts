import { describe, expect, test } from 'bun:test';
import { createDragToken, readDragToken, DRAG_LINK_TTL_MS } from './file-drag-links';

describe('drag links', () => {
  test('round-trips a path until it expires', () => {
    const { token } = createDragToken('s', '/home/a b/ñ.csv', 1000);
    expect(readDragToken('s', token, 1000)).toBe('/home/a b/ñ.csv');
    expect(readDragToken('s', token, 1000 + DRAG_LINK_TTL_MS + 1)).toBeNull();
  });
  test('rejects other secrets and tampering', () => {
    const { token } = createDragToken('s', '/a.txt', 0);
    expect(readDragToken('other', token, 0)).toBeNull();
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ p: '/etc/shadow', e: 9e15 })).toString('base64url');
    expect(readDragToken('s', forged + '.' + mac, 0)).toBeNull();
    expect(readDragToken('s', payload + '.' + mac + '.x', 0)).toBeNull();
    expect(readDragToken('s', 'garbage', 0)).toBeNull();
  });
});
