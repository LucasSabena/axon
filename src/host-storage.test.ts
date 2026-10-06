import {test,expect,afterEach} from 'bun:test';
import {mkdtemp,mkdir,symlink,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {FileVolumes,uniqueVolumes,type FileVolume} from './file-volumes';
import {initHostStorage,resolveHostPath,projectSearchRoots} from './host-storage';
const volume=(p:string,id='disk',mountId='55'):FileVolume=>({id,diskId:'device',device:'/dev/fixture',majorMinor:'8:1',uuid:'fixture-uuid',name:'External',filesystem:'exfat',size:1000,used:100,available:900,external:true,path:p,mountId,readOnly:false,readable:true,canMount:false});
afterEach(()=>initHostStorage());
test('all modules share arbitrary live mount roots while kernel paths and symlink escapes stay blocked',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-paths-'));
 try{
  initHostStorage(undefined,new FileVolumes(async()=>({ok:true,devices:[],volumes:[volume('/workspace/new-disk')]})));
  expect(await resolveHostPath('/workspace/new-disk/new-folder')).toBe('/workspace/new-disk/new-folder');
  await expect(resolveHostPath('/workspace/new-disk-lookalike/a')).rejects.toThrow('permitidos');
  expect(await resolveHostPath('/',{root:true})).toBe('/');
  await expect(resolveHostPath('/proc')).rejects.toThrow('permitidos');
  await symlink('/proc',path.join(dir,'escape'));
  await expect(resolveHostPath(path.join(dir,'escape','version'))).rejects.toThrow('permitidos');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a disconnected custom mount stays blocked over restart even when its empty directory still exists',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-mount-history-')),mount=path.join(dir,'disk'),registry=path.join(dir,'mounts.json');await mkdir(mount);
 try{
  let volumes=[volume(mount)];const run=async()=>({ok:true as const,devices:[],volumes});
  const first=new FileVolumes(run,undefined,registry);await first.snapshot();
  expect(JSON.parse(await readFile(registry,'utf8')).paths).toContain(mount);
  volumes=[];initHostStorage(undefined,new FileVolumes(run,undefined,registry));
  await expect(resolveHostPath(mount+'/new-file',{fresh:true})).rejects.toThrow('desconectado');
  volumes=[volume(mount,'disk','99')];
  expect(await resolveHostPath(mount,{fresh:true,directory:true})).toBe(mount);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('mount aliases count capacity once but retain independent operation identities',async()=>{
 const original=volume('/mnt/axon-disks/owned'),alias=volume('/mnt/externo','alias','66');
 const disks=new FileVolumes(async()=>({ok:true,devices:[],volumes:[original,alias]}));
 expect(uniqueVolumes([original,alias])).toEqual([alias]);
 expect(await disks.validate('/mnt/externo/file','alias:66')).toBe('66');
 await expect(disks.validate('/mnt/externo/file','disk:55')).rejects.toThrow('cambió');
});
test('discovery deduplicates registered directories and skips disconnected roots without deleting configuration',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-discovery-'));
 try{
  await mkdir(path.join(dir,'real'));await symlink(path.join(dir,'real'),path.join(dir,'alias'));
  initHostStorage(undefined,new FileVolumes(async()=>({ok:true,devices:[],volumes:[]})));
  expect(await projectSearchRoots([path.join(dir,'real'),path.join(dir,'alias'),path.join(dir,'missing')])).toEqual([path.join(dir,'real')]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
