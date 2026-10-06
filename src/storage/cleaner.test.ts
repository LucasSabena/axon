import {test,expect} from 'bun:test';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {HostCleaner} from './cleaner';
import {StorageService} from './service';
import {MaintenanceRepository} from './repository';
import {scanRoot} from './scan';
import {boundedCommand} from './host-argv';
const actor={actorId:'fixture',sessionId:'fixture'};
async function fixture(){const home=await mkdtemp(path.join(tmpdir(),'axon-cleaner-fixture-')),cache=home+'/cache';await mkdir(cache);await writeFile(cache+'/one.bin','fixture-one');await writeFile(cache+'/two.bin','fixture-two');const repo=new MaintenanceRepository(home+'/ledger'),helper=await readFile(new URL('./file-task-host.py',import.meta.url),'utf8');const run=async(payload:any)=>{if(payload.home!==home||payload.action==='prepare'&&!payload.from.startsWith(cache+'/'))throw new Error('Fixture confinement');return JSON.parse(await boundedCommand(['python3','-c',helper],JSON.stringify(payload)));};const root={id:'fixture-cache',path:cache,adapterId:'packages',title:'Fixture'};return {home,cache,repo,run,root,clean:async()=>{repo.close();await rm(home,{recursive:true,force:true});}};}
test('Real cleanup worker removes only a frozen fixture selection, publishes progress and reconciles',async()=>{
 const f=await fixture();try{const cleaner=new HostCleaner(async()=>f.home,async()=>({complete:true,references:[],examined:0,unknownProcesses:0,elapsedMs:0}),f.run,f.home),service=new StorageService(f.repo,async()=>[f.root],(r,e,s)=>scanRoot(r,e,s,(t,a)=>[t,...a]),undefined,cleaner),scan=await service.scan(f.root.id);while(f.repo.get<any>('scan',scan.id).state==='running')await Bun.sleep(30);const current=f.repo.get<any>('scan',scan.id),candidate=current.result.candidates.find((c:any)=>c.title==='one.bin'),plan=await service.preparePlan(scan.id,[candidate.id],actor);expect(plan.steps[0].actionId).toBe('host-clean');expect((await service.execute(plan.id,plan.digest,actor)).plan.state).toBe('running');let result;for(let i=0;i<100;i++){result=await service.reconcilePlan(plan.id,actor);if(result.plan.state==='verified')break;await Bun.sleep(30);}expect(result.plan.state).toBe('verified');expect(result.receipts[0].freeBytesBefore).toMatch(/^\d+$/);expect(result.receipts[0].freeBytesAfter).toMatch(/^\d+$/);await expect(lstat(f.cache+'/one.bin')).rejects.toThrow();expect(await readFile(f.cache+'/two.bin','utf8')).toBe('fixture-two');}finally{await f.clean();}
});
test('Incomplete process evidence or an active compiler never enables an effect',async()=>{
 const f=await fixture();try{const result=await scanRoot(f.root,[],undefined,(t,a)=>[t,...a]),c=result.candidates[0];for(const observation of [{complete:false,references:[],examined:0,unknownProcesses:1,elapsedMs:0},{complete:true,references:[{pid:1,source:'cwd',resourceId:c.identity.canonicalPath}],examined:1,unknownProcesses:0,elapsedMs:0}]){const cleaner=new HostCleaner(async()=>f.home,async()=>observation as any,f.run,f.home);expect(await cleaner.prepare(c,f.root)).toHaveProperty('blocker');}expect(await readFile(f.cache+'/one.bin','utf8')).toBe('fixture-one');}finally{await f.clean();}
});
