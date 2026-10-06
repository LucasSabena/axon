import {test,expect} from 'bun:test';
import {reviewLibraryMove,movedReference,type LibraryReferences} from './library-transfer-review';
const state=():LibraryReferences=>({roots:['/media/library'],uploadRoot:'/media/library/uploads',favorites:['/media/library/fotos/a.jpg','/media/library/fotos2/b.jpg'],collections:[{id:'c',name:'Trabajo',paths:['/media/library/fotos/a.jpg']}],shares:[{id:'s',title:'Cliente',paths:['/media/library/fotos/a.jpg'],expires:null,allowDownload:false,pass:'private-hash'}]});
test('external folder review preserves all known references and adds only that folder',()=>{
 const r=reviewLibraryMove(state(),'/media/library/fotos','/mnt/external/Fotos',true,['/media/library/fotos/a.jpg']);
 expect(r.needsConfirmation).toBe(true);expect(r.addRoots).toEqual(['/mnt/external/Fotos']);
 expect(r.impacts.map(i=>i.kind)).toEqual(['favorite','collection','share','index']);
 expect(r.impacts[0].paths).toEqual([{from:'/media/library/fotos/a.jpg',to:'/mnt/external/Fotos/a.jpg'}]);
 expect(JSON.stringify(r)).not.toContain('private-hash');
});
test('moving a configured root and upload folder reviews both even without favorites',()=>{
 const s=state();s.favorites=[];s.collections=[];s.shares=[];
 const r=reviewLibraryMove(s,'/media/library','/mnt/external/library',true,[]);
 expect(r.impacts.map(i=>i.kind)).toEqual(['root','upload']);expect(r.addRoots).toEqual([]);
});
test('approval changes for a new affected reference or changed permissions, not unrelated favorites',()=>{
 const s=state(), review=()=>reviewLibraryMove(s,'/media/library/fotos','/mnt/external/Fotos',true,[]);
 const first=review().revision;s.favorites.push('/media/library/unrelated.jpg');expect(review().revision).toBe(first);
 s.shares[0].allowDownload=true;expect(review().revision).not.toBe(first);
 const next=review().revision;s.collections[0].paths.push('/media/library/fotos/new.jpg');expect(review().revision).not.toBe(next);
});
test('a file outside Library explicitly reviews indexing its parent and aliases follow the same destination',()=>{
 const r=reviewLibraryMove(state(),'/alias/fotos/a.jpg','/mnt/external/a.jpg',false,[],['/alias/fotos/a.jpg','/media/library/fotos/a.jpg']);
 expect(r.addRoots).toEqual(['/mnt/external']);expect(r.impacts[0].paths[0].to).toBe('/mnt/external/a.jpg');
 expect(movedReference('/media/library/fotos2/b.jpg',['/media/library/fotos'],'/mnt/external')).toBe('/media/library/fotos2/b.jpg');
});
test('an unreferenced file outside Library moves without a visibility change',()=>{
 const r=reviewLibraryMove(state(),'/tmp/nota.txt','/mnt/external/nota.txt',false,[]);
 expect(r.needsConfirmation).toBe(false);expect(r.addRoots).toEqual([]);
});
