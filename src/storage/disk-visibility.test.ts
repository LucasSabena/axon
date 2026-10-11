import {test,expect} from 'bun:test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DiskVisibility,visibilityKey} from './disk-visibility';
import {fixtureVolumes} from '../file-volumes';
test('Boot and EFI are hidden by default; overrides persist across mount changes without removing inventory',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-visibility-'));
 try{const file=path.join(dir,'visibility.json'),s=await fixtureVolumes(dir).snapshot(),v=new DiskVisibility(file);let r=await v.apply(s);
  expect(r.volumes.length).toBe(s.volumes.length);expect(r.volumes.find(v=>v.name==='EFI')?.hidden).toBe(true);
  const boot=r.volumes.find(v=>v.name==='EFI')!;await v.set(boot.visibilityKey!,false,s);
  r=await new DiskVisibility(file).apply({...s,volumes:s.volumes.map(v=>({...v,path:v.name==='EFI'?'/boot/efi':v.path,mountId:'changed'}))});
  expect(r.volumes.find(v=>v.name==='EFI')?.hidden).toBe(false);
  const physical=r.devices.find(d=>d.id==='fixture-system')!;await v.set(physical.visibilityKey!,true,s);
  expect((await v.apply(s)).volumes.filter(v=>v.diskId==='fixture-system').every(v=>v.hidden)).toBe(true);
  await v.set(physical.visibilityKey!,false,s);expect((await v.apply(s)).volumes.find(v=>v.name==='EFI')?.hidden).toBe(false);
  await expect(v.set('disk:'+'0'.repeat(64),true,s)).rejects.toThrow('cambió');
  expect(JSON.parse(await readFile(file,'utf8')).version).toBe(1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('concurrent preference writes merge and malformed preferences are preserved',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-visibility-'));
 try{const file=path.join(dir,'visibility.json'),s=await fixtureVolumes(dir).snapshot(),v=new DiskVisibility(file),keys=s.devices.map(d=>visibilityKey('disk',d));
  await Promise.all(keys.map(k=>v.set(k,true,s)));expect((await v.apply(s)).devices.every(d=>d.hidden)).toBe(true);
  await writeFile(file,'broken');await expect(v.apply(s)).rejects.toThrow('configuración');await expect(v.set(keys[0]!,false,s)).rejects.toThrow('configuración');expect(await readFile(file,'utf8')).toBe('broken');
 }finally{await rm(dir,{recursive:true,force:true});}
});
