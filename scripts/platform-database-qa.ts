import {mkdtemp,rm,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {backupWorker} from '../src/platform/backups';
const home=await mkdtemp(path.join(tmpdir(),'axon-database-proof-'));
const name='axon-source-proof-'+crypto.randomUUID();let sourceId='';
async function command(args:string[],stdin?:string|Uint8Array){
  const p=Bun.spawn(args,{stdin:stdin ? new Blob([typeof stdin === 'string' ? stdin : new Uint8Array(stdin)]) : undefined,stdout:'pipe',stderr:'pipe'});
  const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);if(code)throw new Error(`${args[0]} ${args[1]} falló: ${err.slice(0,200)}`);return out.trim();
}
async function wait(id:string){const end=Date.now()+120000;while(Date.now()<end){const status=await backupWorker({action:'status',home,id});if(!['queued','running'].includes(status.state)){if(status.state!=='verified')throw new Error(status.message);return status;}await Bun.sleep(250);}throw new Error('Backup todavía no terminó');}
try{
  const image=await command(['docker','image','inspect','postgres:16-alpine','--format','{{.Id}}']);
  sourceId=await command(['docker','run','-d','--rm','--name',name,'--network','none','--memory','512m','--tmpfs','/var/lib/postgresql/data:rw,size=768m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=proof',image]);
  let ready=false;for(let n=0;n<60;n++){try{if(await command(['docker','exec',sourceId,'cat','/proc/1/comm'])!=='postgres')throw new Error('Bootstrap');await command(['docker','exec',sourceId,'pg_isready','-U','proof']);ready=true;break;}catch{await Bun.sleep(250);}}if(!ready)throw new Error('Fixture PostgreSQL no inició');
  await command(['docker','exec',sourceId,'createdb','-U','proof','axon_fixture']);
  await command(['docker','exec',sourceId,'psql','-U','proof','-d','axon_fixture','-c',"CREATE TABLE restore_proof(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO restore_proof VALUES(1,'Original argentino'),(2,'Restauración comprobada');"]);
  const inventory=await backupWorker({action:'databases',containerId:sourceId});if(!inventory.databases.includes('axon_fixture'))throw new Error('Inventario incompleto');
  const id=crypto.randomUUID();await backupWorker({action:'start',home,id,policy:{id:'postgres-fixture',name:'PostgreSQL de prueba',kind:'postgres',containerId:sourceId,databases:['axon_fixture'],enabled:true}});
  const snapshot=await wait(id);
  await command(['docker','exec',sourceId,'psql','-U','proof','-d','axon_fixture','-c',"UPDATE restore_proof SET value='Actual';"]);
  const restoreId=crypto.randomUUID();await backupWorker({action:'start',home,id:restoreId,mode:'restore',originalId:id});const restored=await wait(restoreId);
  const find=async(dir:string):Promise<string|null>=>{for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()){const found=await find(p);if(found)return found;}else if(e.name==='axon_fixture.dump')return p;}return null;};
  const dump=(await find(restored.restoredPath))!;
  await command(['docker','exec',sourceId,'createdb','-U','proof','axon_recovered']);
  await command(['docker','exec','-i',sourceId,'pg_restore','--exit-on-error','--no-owner','--no-acl','-U','proof','-d','axon_recovered'],new Uint8Array(await readFile(dump)));
  const recovered=await command(['docker','exec',sourceId,'psql','-At','-U','proof','-d','axon_recovered','-c','SELECT value FROM restore_proof ORDER BY id']);
  const current=await command(['docker','exec',sourceId,'psql','-At','-U','proof','-d','axon_fixture','-c','SELECT value FROM restore_proof ORDER BY id']);
  if(recovered!=='Original argentino\nRestauración comprobada'||current!=='Actual\nActual')throw new Error('El dump recuperado no preservó los valores originales o reemplazó el origen');
  const result={passed:true,at:new Date().toISOString(),checks:['Native PostgreSQL inventory','pg_dump custom snapshot','Restic isolated verified restore','Automatic import in temporary PostgreSQL','Recovered exact rows after source mutation','Source database unchanged by recovery'],snapshot:snapshot.snapshot,verifiedDatabases:snapshot.verifiedDatabases,originalPreserved:true};
  await mkdir('docs/platform-expansion-2026-10-05',{recursive:true});await writeFile('docs/platform-expansion-2026-10-05/database-proof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{if(sourceId)await command(['docker','rm','-f',sourceId]);await rm(home,{recursive:true,force:true});}
