import {test,expect} from 'bun:test';
import {snapRevisions} from './tool-inventory';
test('Snap disabled is separate from removal eligibility; current and unknown versions are protected',()=>{
 const rows=snapRevisions('Name Version Rev Tracking Publisher Notes\nfirefox 1 123 latest/stable mozilla disabled\nfirefox 2 124 latest/stable mozilla -\ncore22 1 200 latest/stable canonical base,disabled\n');
 expect(rows.map(r=>r.disabled)).toEqual([true,false,true]);expect(rows.every(r=>!r.canRemove)).toBe(true);expect(()=>snapRevisions('Formato cambiado')).toThrow();
});
