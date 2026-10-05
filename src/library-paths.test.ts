import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,symlink,unlink,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import * as path from 'node:path';
import {canonicalRoots,canonicalLibraryFile} from './library-paths';
import {trackShare} from './library-activity';

test('relative ENTREGAS links resolve through the host mount, reject broken/outside/directory links and survive recreation',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-library-links-'));
 try {
  const mount=path.join(dir,'hostfs'), root='/home/video', original=root+'/renders/video.mp4', link=root+'/ENTREGAS/video.mp4';
  const mapper={toContainer:(p:string)=>mount+p,toHost:(p:string)=>p.startsWith(mount+'/')?p.slice(mount.length):p};
  await mkdir(mapper.toContainer(root+'/renders'),{recursive:true});await mkdir(mapper.toContainer(root+'/ENTREGAS'));
  await writeFile(mapper.toContainer(original),'original');await writeFile(mapper.toContainer('/home/private.mp4'),'outside');
  await symlink('../renders/video.mp4',mapper.toContainer(link));
  await symlink('../renders/missing.mp4',mapper.toContainer(root+'/ENTREGAS/broken.mp4'));
  await symlink('../../private.mp4',mapper.toContainer(root+'/ENTREGAS/outside.mp4'));
  await symlink('../renders',mapper.toContainer(root+'/ENTREGAS/folder.mp4'));
  const roots=[root],realRoots=await canonicalRoots(roots,mapper);
  expect(await canonicalLibraryFile(link,roots,realRoots,mapper)).toBe(original);
  for(const name of ['broken','outside','folder'])expect(await canonicalLibraryFile(root+'/ENTREGAS/'+name+'.mp4',roots,realRoots,mapper)).toBeNull();
  expect(await canonicalLibraryFile('/home/video-other/a.mp4',roots,realRoots,mapper)).toBeNull();
  const a=await stat(mapper.toContainer(link)),b=await stat(mapper.toContainer(original));
  expect([a.dev,a.ino,a.size,a.mtimeMs]).toEqual([b.dev,b.ino,b.size,b.mtimeMs]);
  const saved=await canonicalLibraryFile(link,roots,realRoots,mapper);
  await unlink(mapper.toContainer(link));expect(await canonicalLibraryFile(saved!,roots,realRoots,mapper)).toBe(original);
  await symlink('../renders/video.mp4',mapper.toContainer(link));expect(await canonicalLibraryFile(saved!,roots,realRoots,mapper)).toBe(original);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('share activity deduplicates retries, counts visits and started downloads and bounds retained history',()=>{
 const s={views:0,downloads:0,activity:[],visitors:[]} as import('./library-activity').TrackedShare;
 const event={t:1_000_000,kind:'view' as const,visitor:'anon',client:'Firefox'};
 expect(trackShare(s,event)).toBe(true);expect(trackShare(s,{...event,t:event.t+1000})).toBe(false);
 expect(trackShare(s,{...event,kind:'play',name:'video.mp4'})).toBe(true);expect(s.downloads).toBe(0);
 expect(trackShare(s,{...event,kind:'zip'})).toBe(true);expect(s.downloads).toBe(1);expect(s.visitors).toEqual(['anon']);
 for(let i=0;i<150;i++)trackShare(s,{...event,kind:'download',visitor:'v'+i,name:'file'});
 expect(s.activity?.length).toBe(100);expect(s.views).toBe(1);expect(s.downloads).toBe(151);
});
