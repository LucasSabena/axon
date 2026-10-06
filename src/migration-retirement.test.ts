import {test,expect} from 'bun:test';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {MigrationRetirement} from './migration-retirement';
import {Migrations} from './app-migrations';
import {ComposeDrafts} from './compose-drafts';
import {MaintenanceRepository} from './storage/repository';
import {hash} from './storage/policy';
const actor={actorId:'fixture',sessionId:'test'};
test('Retirement requires evidence, reconstructible origin and no dependents; failed preparation preserves the host',async()=>{
 const root=await mkdtemp(tmpdir()+'/axon-retirement-'),repo=new MaintenanceRepository(root+'/ledger'),file=root+'/compose.yaml';
 const original='services:\n  homepage:\n    image: fixture:old\n  neighbor:\n    image: fixture:old\n    depends_on: [homepage]\n';await writeFile(file,original);
 const installation:any={id:'fixture',name:'homepage',container:{id:'fixture-id',project:'fixture',service:'homepage',configFiles:[file]}};
 const migrations=new Migrations(repo,async()=>[installation]),drafts=new ComposeDrafts(repo);let preparations=0;
 const releases:any={onBeforeExecute:()=>{},prepare:async()=>{preparations++;throw new Error('native context blocked');}};
 const retirement=new MigrationRetirement(migrations,drafts,releases);
 async function verify(){let r=await migrations.compare('homepage');for(const g of r.gaps)r=migrations.evidence('homepage',r.revision,g,'passed');}
 try{
  await expect(retirement.prepare('homepage',actor)).rejects.toThrow('Primero');expect(preparations).toBe(0);
  await verify();installation.container.configFiles=[];await verify();await expect(retirement.prepare('homepage',actor)).rejects.toThrow('no reconstruible');
  installation.container.configFiles=[file];await verify();await expect(retirement.prepare('homepage',actor)).rejects.toThrow('depende');expect(drafts.get(file)).toBeUndefined();
  const safe=original.replace('    depends_on: [homepage]\n','');await writeFile(file,safe);
  drafts.save(file,safe+'# personal draft\n',safe,hash(safe));await expect(retirement.prepare('homepage',actor)).rejects.toThrow('borrador pendiente');expect(preparations).toBe(0);
  drafts.discard(file,drafts.get(file)!.revision);await expect(retirement.prepare('homepage',actor)).rejects.toThrow('native context blocked');expect(preparations).toBe(1);expect(drafts.get(file)).toBeUndefined();expect(await readFile(file,'utf8')).toBe(safe);
 }finally{repo.close();await rm(root,{recursive:true,force:true});}
});
