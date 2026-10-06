import {expect,test} from 'bun:test';
import {containerToHost} from './host';

test('the canonical container mount root translates to the host root',()=>{
 expect(containerToHost('/hostfs','/hostfs')).toBe('/');
 expect(containerToHost('/hostfs/','/hostfs')).toBe('/');
 expect(containerToHost('/hostfs/home/user','/hostfs')).toBe('/home/user');
});
test('host path translation preserves boundaries and direct-host paths',()=>{
 expect(containerToHost('/hostfs-other/home','/hostfs')).toBe('/hostfs-other/home');
 expect(containerToHost('/hostfs-other','/hostfs')).toBe('/hostfs-other');
 expect(containerToHost('/home/user','')).toBe('/home/user');
 expect(containerToHost('/','')).toBe('/');
 expect(containerToHost('','/hostfs')).toBe('');
});
