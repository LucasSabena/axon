import {test,expect} from 'bun:test';
import {scannerAncestors,matchingResource,procFields} from './activity';
test('activity excludes scanner ancestry, matches boundaries and deleted handles without returning argument content',()=>{
 expect([...scannerAncestors([{pid:3,ppid:2},{pid:2,ppid:1},{pid:1,ppid:0},{pid:4,ppid:2}],3)]).toEqual([3,2,1]);
 expect(matchingResource('/store/links/tool/bin (deleted)',['/store/links/tool'])).toBe('/store/links/tool');expect(matchingResource('/cache-other',['/cache'])).toBeNull();
 const fields=['S','12',...Array(17).fill('0'),'987'];expect(procFields('34 (name (with parens)) '+fields.join(' '))).toEqual({ppid:12,start:'987'});
});
