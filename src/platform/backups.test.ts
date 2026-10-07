import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Database} from 'bun:sqlite';
import {backupWorker} from './backups';

async function wait(home:string,id:string) {
  const end=Date.now()+90000;
  while(Date.now()<end){const result=await backupWorker({action:'status',home,id});if(!['queued','running'].includes(result.state))return result;await Bun.sleep(150);}
  throw new Error('Worker de backup no terminó en el plazo de la fixture');
}
test('Restic captures an explicit snapshot, verifies restoration and recovers old content without replacing the live source',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'axon-backup-fixture-'));const root=path.join(home,'project');await mkdir(root);await writeFile(path.join(root,'source.txt'),'Contenido original\n');
  const id=crypto.randomUUID();
  try{
    await backupWorker({action:'start',home,id,policy:{id:'files-fixture',name:'Archivos de fixture',kind:'files',source:root,enabled:true}});
    const backed=await wait(home,id);expect(backed.state).toBe('verified');expect(backed.snapshot).toMatch(/^[a-f0-9]{8,64}$/);expect(backed.verifiedAt).toBeGreaterThan(0);expect(backed.disasterRecovery).toBe(false);
    await writeFile(path.join(root,'source.txt'),'Versión actual\n');
    const restoredId=crypto.randomUUID();await backupWorker({action:'start',home,id:restoredId,mode:'restore',originalId:id});
    const restored=await wait(home,restoredId);expect(restored.state).toBe('verified');
    expect(await readFile(path.join(restored.restoredPath,root.slice(1),'source.txt'),'utf8')).toBe('Contenido original\n');
    expect(await readFile(path.join(root,'source.txt'),'utf8')).toBe('Versión actual\n');
    expect(restored.restoredPath).not.toBe(root);
  }finally{await rm(home,{recursive:true,force:true});}
},120000);
test('configuration backup uses SQLite online backup for WAL data and verifies recovered integrity',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'axon-backup-config-'));const config=path.join(home,'configuration');await mkdir(path.join(config,'platform'),{recursive:true});await writeFile(path.join(config,'config.json'),'{"fixture":true}');
  const db=new Database(path.join(config,'platform','platform.sqlite'));db.exec("PRAGMA journal_mode=WAL; CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES('committed WAL');");
  try{
    const id=crypto.randomUUID();await backupWorker({action:'start',home,id,policy:{id:'config-fixture',name:'Configuración fixture',kind:'configuration',source:config,enabled:true}});
    const backed=await wait(home,id);expect(backed.state).toBe('verified');expect(backed.covered).toContain('platform/platform.sqlite');
    const restoredId=crypto.randomUUID();await backupWorker({action:'start',home,id:restoredId,mode:'restore',originalId:id});const restored=await wait(home,restoredId);expect(restored.state).toBe('verified');
    const find=async(dir:string):Promise<string|null>=>{const {readdir}=await import('node:fs/promises');for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const result=await find(p);if(result)return result;}else if(e.name==='platform.sqlite')return p;}return null;};
    const recovered=new Database((await find(restored.restoredPath))!,{readonly:true});expect(recovered.query('SELECT value FROM proof').get()).toEqual({value:'committed WAL'});recovered.close();
  }finally{db.close();await rm(home,{recursive:true,force:true});}
},120000);
test('backup worker rejects symlink roots and self-recursive sources before launching',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'axon-backup-paths-'));await mkdir(path.join(home,'actual'));await symlink(path.join(home,'actual'),path.join(home,'link'));
  try{
    // A deterministic rejection is a durable 'failed' receipt (phase
    // 'rejected'), never a spawned worker — and the status action agrees.
    const bad=await backupWorker({action:'start',home,id:crypto.randomUUID(),policy:{id:'fixture',kind:'files',source:path.join(home,'link')}})as any;
    expect(bad.state).toBe('failed');expect(bad.phase).toBe('rejected');expect(bad.message).toContain('enlazadas');expect(bad.pid).toBeUndefined();
    const recursive=await backupWorker({action:'start',home,id:crypto.randomUUID(),policy:{id:'fixture',kind:'files',source:home}})as any;
    expect(recursive.state).toBe('failed');expect(recursive.phase).toBe('rejected');expect(recursive.message).toContain('repositorio');
    expect((await backupWorker({action:'status',home,id:recursive.id})as any).state).toBe('failed');
  }finally{await rm(home,{recursive:true,force:true});}
});
test('a chosen repository stores encrypted snapshots separately and survives policy changes during recovery',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'axon-backup-other-disk-')),source=path.join(home,'project'),repository=path.join(home,'disk','AXON-Respaldos');await mkdir(source);await writeFile(path.join(source,'proof.txt'),'Original de otro disco');
 try{
  const id=crypto.randomUUID();await backupWorker({action:'start',home,id,policy:{id:'external',kind:'files',source,repository,enabled:true}});
  const result=await wait(home,id);expect(result.state).toBe('verified');expect(await Bun.file(path.join(repository,'config')).exists()).toBe(true);
  expect(await Bun.file(path.join(repository,'repository-password')).exists()).toBe(false);
  await writeFile(path.join(source,'proof.txt'),'Actual');const restoredId=crypto.randomUUID();await backupWorker({action:'start',home,id:restoredId,mode:'restore',originalId:id});const restored=await wait(home,restoredId);expect(restored.state).toBe('verified');
  expect(await readFile(path.join(restored.restoredPath,source.slice(1),'proof.txt'),'utf8')).toBe('Original de otro disco');
  const wrong=crypto.randomUUID(),missingRepo=path.join(home,'wrong-disk','repository');await backupWorker({action:'start',home,id:wrong,repositoryMountId:'-1',policy:{id:'wrong',kind:'files',source,repository:missingRepo}});
  const rejected=await wait(home,wrong);expect(rejected.state).toBe('failed');expect(rejected.message).toContain('desconectado');expect(await Bun.file(path.join(missingRepo,'config')).exists()).toBe(false);
 }finally{await rm(home,{recursive:true,force:true});}
},120000);

test('multiple folders include hidden and build files by default; browser and selective recovery handle literal wildcard names',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'axon-backup-selected-')),a=path.join(home,'documents'),b=path.join(home,'photos'),repository=path.join(home,'disk','backups');
 await mkdir(path.join(a,'dist'),{recursive:true});await mkdir(b);await writeFile(path.join(a,'.private'),'Hidden original');await writeFile(path.join(a,'dist','result.txt'),'Build output');await writeFile(path.join(a,'report[1]*.txt'),'Chosen original');await writeFile(path.join(a,'report1x.txt'),'Must not recover');await writeFile(path.join(b,'picture.txt'),'Picture');
 try{
  const id=crypto.randomUUID();await backupWorker({action:'start',home,id,policy:{id:'selected',kind:'files',source:a,sources:[a,b],repository,exclusions:[],enabled:true}});const backed=await wait(home,id);expect(backed.state).toBe('verified');expect(backed.files).toBe(5);
  const listing=await backupWorker({action:'browse',home,id,folder:a});expect(listing.entries.map((e:any)=>e.name)).toContain('report[1]*.txt');expect(listing.entries.map((e:any)=>e.name)).toContain('.private');
  await writeFile(path.join(a,'report[1]*.txt'),'Current original');const restoredId=crypto.randomUUID();await backupWorker({action:'start',home,id:restoredId,mode:'restore',originalId:id,paths:[path.join(a,'report[1]*.txt'),path.join(a,'dist')]});
  const restored=await wait(home,restoredId);expect(restored.state).toBe('verified');expect(await readFile(path.join(restored.restoredPath,a.slice(1),'report[1]*.txt'),'utf8')).toBe('Chosen original');expect(await readFile(path.join(restored.restoredPath,a.slice(1),'dist/result.txt'),'utf8')).toBe('Build output');
  expect(await Bun.file(path.join(restored.restoredPath,a.slice(1),'report1x.txt')).exists()).toBe(false);expect(await readFile(path.join(a,'report[1]*.txt'),'utf8')).toBe('Current original');
  const missing=crypto.randomUUID();await backupWorker({action:'start',home,id:missing,mode:'restore',originalId:id,paths:[a+'/absent.txt']});expect((await wait(home,missing)).state).toBe('failed');
 }finally{await rm(home,{recursive:true,force:true});}
},120000);

test('retention forgets only old verified versions of this plan after a new verified capture, preserving unverified and unrelated versions',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'axon-backup-retention-')),source=path.join(home,'documents'),repository=path.join(home,'disk','backups');await mkdir(source);await writeFile(source+'/note.txt','Original');
 try{
  const initial=crypto.randomUUID();await backupWorker({action:'start',home,id:initial,policy:{id:'retention',kind:'files',source,repository,exclusions:[],enabled:true}});expect((await wait(home,initial)).state).toBe('verified');
  const base=home+'/.local/share/axon/backups',env={...process.env,RESTIC_REPOSITORY:repository,RESTIC_PASSWORD_FILE:base+'/repository-password'};
  const command=async(args:string[])=>{const p=Bun.spawn(['restic',...args],{env,stdout:'pipe',stderr:'pipe'});const out=await new Response(p.stdout).text();if(await p.exited)throw new Error(await new Response(p.stderr).text());return out;};
  const old=async(tag:string)=>{const lines=(await command(['backup','--json','--time','2020-01-01 00:00:00','--tag',tag,source])).trim().split('\n');return JSON.parse(lines.at(-1)!).snapshot_id;};
  const verified=await old('axon-policy:retention'),unverified=await old('axon-policy:retention'),other=await old('axon-policy:other');
  await command(['restore',verified,'--target',home+'/proof','--verify']);
  await writeFile(base+'/jobs/'+crypto.randomUUID()+'.json',JSON.stringify({mode:'backup',state:'verified',snapshot:verified,policy:{id:'retention',repository}}),{mode:0o600});
  const next=crypto.randomUUID();await backupWorker({action:'start',home,id:next,policy:{id:'retention',kind:'files',source,repository,exclusions:[],retentionDays:30,enabled:true}});const result=await wait(home,next);expect(result.state).toBe('verified');expect(result.forgottenSnapshots).toContain(verified);
  const remaining=JSON.parse(await command(['snapshots','--json'])).map((s:any)=>s.id);expect(remaining).not.toContain(verified);expect(remaining).toContain(unverified);expect(remaining).toContain(other);expect(remaining).toContain(result.snapshot);
 }finally{await rm(home,{recursive:true,force:true});}
},120000);

test('large-backup verification reads all encrypted data and exercises recovery when a second full copy does not fit on the server',async()=>{
 const home=await mkdtemp(path.join(tmpdir(),'axon-backup-stream-')),source=home+'/documents',repository=home+'/disk/backups';await mkdir(source);await writeFile(source+'/note.txt','Verified bytes');
 try{
  const originalId=crypto.randomUUID(),policy={id:'stream',kind:'files',source,repository,exclusions:[],enabled:true};await backupWorker({action:'start',home,id:originalId,policy});const original=await wait(home,originalId);expect(original.state).toBe('verified');
  const id=crypto.randomUUID(),receipt=home+'/.local/share/axon/backups/jobs/'+id+'.json';await writeFile(receipt,JSON.stringify({id,policy,mode:'verify',snapshot:original.snapshot,bytes:original.bytes,state:'queued'}),{mode:0o600});
  const python="import sys, importlib.util, collections, json; spec=importlib.util.spec_from_file_location('backup',sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); module.shutil.disk_usage=lambda path: collections.namedtuple('Space','total used free')(100,99,1); request=json.load(sys.stdin); module.worker(request)";
  const worker=Bun.spawn(['python3','-c',python,path.resolve('src/platform/backup-host.py')],{stdin:'pipe',stdout:'pipe',stderr:'pipe'});worker.stdin.write(JSON.stringify({id,home}));worker.stdin.end();expect(await worker.exited).toBe(0);
  const result=JSON.parse(await readFile(receipt,'utf8'));expect(result.state).toBe('verified');expect(result.verification).toBe('full-data-read-and-file-recovery');expect(result.recoveredSample).toBe(source+'/note.txt');expect(await readFile(source+'/note.txt','utf8')).toBe('Verified bytes');expect(await Bun.file(home+'/.local/share/axon/backups/verification/'+id+'/documents/note.txt').exists()).toBe(false);
 }finally{await rm(home,{recursive:true,force:true});}
},120000);
