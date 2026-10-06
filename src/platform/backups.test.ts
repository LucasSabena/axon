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
    await expect(backupWorker({action:'start',home,id:crypto.randomUUID(),policy:{id:'fixture',kind:'files',source:path.join(home,'link')}})).rejects.toThrow('enlazadas');
    await expect(backupWorker({action:'start',home,id:crypto.randomUUID(),policy:{id:'fixture',kind:'files',source:home}})).rejects.toThrow('repositorio');
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
