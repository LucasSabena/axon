import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ComposeReleases,type ComposeRunner} from './compose-releases';
import {ComposeDrafts} from './compose-drafts';
import {MaintenanceRepository} from './storage/repository';
const actor={actorId:'fixture',sessionId:'one'};
test('Compose release intent precedes effects, is actor-bound and repeated apply does not reapply',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'axon-compose-ledger-'));const repo=new MaintenanceRepository(root+'/ledger'),drafts=new ComposeDrafts(repo);const p=root+'/compose.yaml',original='services:\n  one:\n    image: fixture:old';drafts.save(p,'services:\n  one:\n    image: fixture:new',original,(await import('./storage/policy')).hash(original));let effect=0;
 const statuses=new Map<string,any>();const runner:ComposeRunner=async payload=>{
  if(payload.action==='prepare'){const s={ok:true,id:payload.id,path:p,state:'planned',project:'fixture',digest:'immutable',createdAt:Date.now(),expiresAt:Date.now()+300000,message:'Ready',changed:[{name:'one',fields:['image'],image:'fixture:new'}],active:['one'],inactive:['off'],canRollback:false};statuses.set(String(payload.id),s);return s;}
  const s=statuses.get(String(payload.id));if(payload.action==='apply'){expect(repo.get<any>('compose-release',s.id)?.state).toBe('running');effect++;s.state='verified';s.canRollback=true;}if(payload.action==='rollback'){effect++;s.state='restored';s.canRollback=false;}return {...s};
 };
 try{const releases=new ComposeReleases(repo,drafts,async()=>root,runner),plan=await releases.prepare(p,actor);await expect(releases.execute(plan.id,plan.digest,{...actor,sessionId:'other'})).rejects.toThrow();expect(effect).toBe(0);expect((await releases.execute(plan.id,plan.digest,actor)).state).toBe('verified');expect(drafts.get(p)).toBeUndefined();await releases.execute(plan.id,plan.digest,actor);expect(effect).toBe(1);expect((await releases.execute(plan.id,plan.digest,actor,true)).state).toBe('restored');expect(effect).toBe(2);}finally{repo.close();await rm(root,{recursive:true,force:true});}
});
test('Recovery locks may only resume the same operation; ledger failure cannot start a worker',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'axon-compose-ledger-')),repo=new MaintenanceRepository(root+'/ledger');try{repo.exclusive('one',['docker:compose'],()=>{});expect(()=>repo.exclusiveRecovery('two',['docker:compose'],()=>{})).toThrow();expect(repo.exclusiveRecovery('one',['docker:compose'],()=>7)).toBe(7);repo.releaseReconciled('one');expect(repo.exclusive('two',['docker:compose'],()=>9)).toBe(9);}finally{repo.close();await rm(root,{recursive:true,force:true});}
});
