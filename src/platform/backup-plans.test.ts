import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Hono} from 'hono';
import {PlatformStore} from './store';
import {Backups,registerBackups,type BackupJob} from './backups';
import {backupDate,backupTime,firstBackupAt,followingBackupAt} from './backup-schedule';
import type {FileVolume} from '../file-volumes';
const utc=(s:string)=>Date.parse(s);
async function fixture(){
 const home=await mkdtemp(path.join(tmpdir(),'axon-backup-plans-'));await mkdir(home+'/source');await mkdir(home+'/disk-a');await mkdir(home+'/disk-b');
 const store=new PlatformStore(home+'/state');
 const volume=(id:string,p:string):FileVolume=>({id,diskId:id,device:id,majorMinor:id,uuid:id,name:id,filesystem:'fixture',size:1e9,available:1e9,path:p,mountId:id,readOnly:false,readable:true,external:id!=='internal',canMount:false});
 let volumes=[volume('internal',home),volume('disk-a',home+'/disk-a'),volume('disk-b',home+'/disk-b')];
 const jobs=new Map<string,any>();const starts:any[]=[];let unavailable=false;
 const run=async(r:any)=>{
  if(unavailable)throw Error('Transport unavailable');
  if(r.action==='availability')return {ok:true,restic:true,root:home};
  if(r.action==='start'){starts.push(r);const job={id:r.id,policy:r.policy,state:'running',mode:r.mode};jobs.set(r.id,job);return job;}
  if(r.action==='status')return jobs.get(r.id)||{state:'interrupted'};
  if(r.action==='recovery-kit')return {password:'fixture-password'};
  throw Error(r.action);
 };
 const hub:any={project:(id:string)=>{if(id!=='p')throw Error('unknown');return {id:'p',cwd:home+'/source'};},sources:{projects:()=>[{id:'p',name:'Fixture',cwd:home+'/source'}],containers:async()=>[]}};
 const backups=new Backups(store,hub,async()=>home,async()=>home+'/source',run,{volumes:async()=>({ok:true,devices:[],volumes}),resolve:async p=>p});
 const input={name:'Mis documentos',kind:'files',sources:[home+'/source'],destinations:[{path:home+'/disk-a'},{path:home+'/disk-b'}],enabled:true,intervalDays:3,dailyAt:'04:00',retentionDays:30,exclusions:[]};
 return {home,store,backups,starts,jobs,input,setVolumes:(v:FileVolume[])=>{volumes=v;},getVolumes:()=>volumes,setUnavailable:(value:boolean)=>{unavailable=value;},done:(id:string)=>jobs.set(id,{...jobs.get(id),state:'verified',snapshot:'a'.repeat(64),verifiedAt:Date.now()}),close:async()=>{store.close();await rm(home,{recursive:true,force:true});}};
}
test('calendar schedules use Argentina, advance by days and coalesce missed slots',()=>{
 expect(backupDate(utc('2026-10-07T01:00:00Z'))).toBe('2026-10-06');
 const next=firstBackupAt(utc('2026-10-06T12:00:00Z'),'04:00');expect(next).toBe(utc('2026-10-07T07:00:00Z'));
 expect(followingBackupAt(next,utc('2026-10-20T12:00:00Z'),3)).toBe(utc('2026-10-22T07:00:00Z'));
 expect(backupTime('2026-10-07','04:00')).toBe(next);
});
test('arbitrary folders and two independent disks persist, physical duplicates and recursive folders are rejected',async()=>{
 const f=await fixture();try{
  const p=await f.backups.save(f.input,'owner');expect(p.sources).toEqual([f.home+'/source']);expect(p.destinations).toHaveLength(2);expect(p.destinations![0].path).toBe(f.home+'/disk-a/AXON-Backups/'+p.id);
  expect(p.exclusions).toEqual([]);expect(f.backups.schedule(p)[0].nextAt).toBeGreaterThan(Date.now());
  await expect(f.backups.save({...f.input,destinations:[{path:f.home+'/another-folder'}]},'owner')).rejects.toThrow('físico diferente');
  await expect(f.backups.save({...f.input,sources:[f.home+'/source',f.home+'/source/nested']},'owner')).rejects.toThrow('principal');
  await expect(f.backups.save({...f.input,destinations:[{path:f.home+'/disk-a'},{path:f.home+'/disk-a/other'}]},'owner')).rejects.toThrow('ya está elegido');
  await expect(f.backups.save({...f.input,intervalDays:1.5},'owner')).rejects.toThrow('frecuencia');
  await expect(f.backups.save({...f.input,destinations:[{path:f.home+'/disk-a',volumeUuid:'replaced'}]},'owner')).rejects.toThrow('desde que lo elegiste');
  await expect(f.backups.save({...f.input,sourceIdentities:{[f.home+'/source']:{id:'internal',uuid:'old-disk'}}},'owner')).rejects.toThrow('desde que elegiste');
 }finally{await f.close();}
});
test('each disk has a durable job, launches serially and repeated clicks do not duplicate pending copies',async()=>{
 const f=await fixture();try{
  const p=await f.backups.save(f.input,'owner');await Promise.all([f.backups.start(p.id,'owner'),f.backups.start(p.id,'owner')]);
  expect(f.store.list('backup-job')).toHaveLength(2);expect(f.starts).toHaveLength(1);
  const first=f.starts[0].id;f.done(first);await f.backups.list();expect(f.starts).toHaveLength(2);
  expect(f.starts[0].policy.repository).not.toBe(f.starts[1].policy.repository);
  f.done(f.starts[1].id);const results=await f.backups.list();expect(results.every(j=>j.state==='verified')).toBe(true);
  expect(f.backups.schedule(p)[0].nextAt).toBe(firstBackupAt(p.createdAt!,'04:00'));
 }finally{await f.close();}
});
test('an absent or substituted destination stays pending, the available disk completes and UUID remount resumes safely',async()=>{
 const f=await fixture();try{
  const p=await f.backups.save(f.input,'owner');const original=f.getVolumes();f.setVolumes(original.filter(v=>v.uuid!=='disk-b'));
  await f.backups.start(p.id,'owner');expect(f.starts).toHaveLength(1);f.done(f.starts[0].id);await f.backups.list();
  const waiting=f.store.list<BackupJob>('backup-job').find(j=>j.state==='waiting')!;expect(waiting.destinationLabel).toBe('disk-b');expect(f.starts).toHaveLength(1);
  f.setVolumes([...original.filter(v=>v.uuid!=='disk-b'),{...original[2],uuid:'replacement'}]);f.store.put('backup-job',waiting.id,{...waiting,retryAt:0});await f.backups.list();expect(f.starts).toHaveLength(1);
  f.setVolumes([...original.filter(v=>v.uuid!=='disk-b'),{...original[2],id:'new-device',path:f.home+'/remounted',mountId:'new-mount'}]);f.store.put('backup-job',waiting.id,{...waiting,retryAt:0});await f.backups.list();expect(f.starts).toHaveLength(2);expect(f.starts[1].policy.repository).toBe(f.home+'/remounted/AXON-Backups/'+p.id);
 }finally{await f.close();}
});
test('a replaced source is never read and unknown worker state blocks another launch',async()=>{
 const f=await fixture();try{
  const p=await f.backups.save(f.input,'owner');const original=f.getVolumes();f.setVolumes(original.map(v=>v.diskId==='internal'?{...v,uuid:'replacement'}:v));await f.backups.start(p.id,'owner');expect(f.starts).toHaveLength(0);expect(f.store.list<BackupJob>('backup-job').every(j=>j.state==='waiting')).toBe(true);
  f.setVolumes(original);for(const j of f.store.list<BackupJob>('backup-job'))f.store.put('backup-job',j.id,{...j,retryAt:0});await f.backups.list();expect(f.starts).toHaveLength(1);
  f.setUnavailable(true);await f.backups.list();expect(f.starts).toHaveLength(1);
 }finally{await f.close();}
});
test('scheduled copies catch up after restart, do not consume a failed slot and pause cancels only jobs not yet launched',async()=>{
 const f=await fixture();try{
  const p=await f.backups.save(f.input,'owner');const due=Date.now()-10*86400000;
  for(const t of p.destinations!)f.store.put('backup-schedule',p.id+':'+t.id,{nextAt:due});
  await f.backups.tick();expect(f.store.list('backup-job')).toHaveLength(2);await f.backups.tick();expect(f.store.list('backup-job')).toHaveLength(2);
  expect(f.backups.schedule(p).every(s=>s.nextAt===due)).toBe(true);
  const first=f.starts[0].id;f.done(first);await f.backups.toggle(p.id,false,'owner');await f.backups.list();expect(f.starts).toHaveLength(1);expect(f.store.list<BackupJob>('backup-job').filter(j=>j.state==='cancelled')).toHaveLength(1);expect((await f.backups.status(first)).state).toBe('verified');
 }finally{await f.close();}
});
test('recovery follows the original repository after policy editing, runs in the same queue and supports selected paths',async()=>{
 const f=await fixture();try{
  const p=await f.backups.save({...f.input,destinations:[f.input.destinations[0]]},'owner');await f.backups.start(p.id,'owner');const first=f.starts[0];f.done(first.id);await f.backups.list();
  await f.backups.save({...f.input,id:p.id,destinations:[f.input.destinations[1]]},'owner');
  const recovered=await f.backups.recover(first.id,'restore','owner',[f.home+'/source/a.txt']);expect(recovered.policy.repository).toBe(first.policy.repository);expect(f.starts[1].paths).toEqual([f.home+'/source/a.txt']);
  expect(f.starts[1].mode).toBe('restore');expect(f.starts[1].originalId).toBe(first.id);
  const kit=await f.backups.recoveryKit('owner');expect(kit.repositories.map(r=>r.path)).toContain(first.policy.repository);
 }finally{await f.close();}
});
test('administrator routes validate shape, export recovery material only on explicit POST and keep it out of audit',async()=>{
 const f=await fixture();try{
  const app=new Hono();app.use('*',async(c,next)=>{c.set('user','owner');await next();});registerBackups(app,f.backups);
  const response=await app.request('/api/backups/recovery-kit',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect((await response.json()).password).toBe('fixture-password');expect(JSON.stringify(f.store.audit())).not.toContain('fixture-password');
  expect((await app.request('/api/backups/recovery-kit')).status).toBe(404);
  const p=await f.backups.save(f.input,'owner');const injected=await app.request('/api/backups/policies/'+p.id,{method:'PATCH',body:JSON.stringify({enabled:false,repository:'/etc'})});expect(injected.status).toBe(400);
 }finally{await f.close();}
});


test('completion of a running copy cannot move the next scheduled slot after its configuration was edited',async()=>{
 const f=await fixture();try{
  const p=await f.backups.save({...f.input,destinations:[f.input.destinations[0]]},'owner');
  f.store.put('backup-schedule',p.id+':'+p.destinations![0].id,{nextAt:Date.now()-86400000});await f.backups.tick();const first=f.starts[0].id;
  const updated=await f.backups.save({...f.input,id:p.id,sources:[f.home+'/new-source'],intervalDays:7,destinations:p.destinations!.map(t=>({id:t.id,path:t.path}))},'owner');
  const due=f.backups.schedule(updated)[0].nextAt;expect(updated.revision).not.toBe(p.revision);f.done(first);await f.backups.list();expect(f.backups.schedule(updated)[0].nextAt).toBe(due);
 }finally{await f.close();}
});
