// Creates only a unique, isolated Docker project; no host mounts or user data.
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {boundedCommand} from '../src/storage/host-argv';
const home=await mkdtemp(path.join(tmpdir(),'axon-compose-fixture-')),project='axon-qa-'+crypto.randomUUID().slice(0,8),file=path.join(home,'compose.yaml');
const helper=await readFile(new URL('../src/storage/compose-release-host.py',import.meta.url),'utf8');
const run=async(p:Record<string,unknown>)=>JSON.parse(await boundedCommand(['python3','-c',helper],JSON.stringify({...p,home})));
const docker=async(args:string[])=>{const p=Bun.spawn(['docker',...args],{stdout:'pipe',stderr:'pipe'});const [code,text]=await Promise.all([p.exited,new Response(p.stdout).text()]);if(code)throw new Error('Fixture Docker command failed: '+args[0]);return text.trim();};
const assert=(v:unknown,m:string)=>{if(!v)throw new Error(m);};
let image='';for(const name of ['busybox:latest','alpine:latest','server-stack-axon:latest']){try{await docker(['image','inspect',name,'--format','{{.Id}}']);image=name;break;}catch{}}
if(!image){await rm(home,{recursive:true,force:true});throw new Error('No known local fixture image; no image is pulled automatically');}
const content=(revision:string)=>JSON.stringify({name:project,services:Object.fromEntries(['selected','neighbor','off'].map(n=>[n,{image,command:['sleep','180'],network_mode:'none',read_only:true,cap_drop:['ALL'],security_opt:['no-new-privileges:true'],environment:{AXON_FIXTURE_REV:n==='selected'?revision:'preserved'}}]))});
const base=['compose','-p',project,'-f',file];const checks:string[]=[];
async function wait(id:string,wanted:string){let r:any;for(let i=0;i<200;i++){r=await run({action:'status',id});if(r.state===wanted)return r;if(['interrupted','failed'].includes(r.state))throw new Error(r.message);await Bun.sleep(100);}throw new Error('Fixture worker did not finish');}
try{
 await writeFile(file,content('before'),{mode:0o600});await docker([...base,'up','-d','--no-build','--pull','never','selected','neighbor']);
 const before=await docker([...base,'ps','-q','neighbor']);
 const id=crypto.randomUUID(),plan=await run({action:'prepare',id,path:file,content:content('after')});assert(plan.ok,plan.error);assert(plan.active.join()==='selected','Only changed running service is selected');
 await run({action:'apply',id});const receipt=await wait(id,'verified');assert(receipt.canRollback,'Recovery checkpoint published');
 assert(await docker([...base,'ps','-q','neighbor'])===before,'Unchanged neighbor was recreated');assert(await docker([...base,'ps','-q','off'])==='','Previously stopped service started');
 checks.push('Changed service verified; neighbor identity preserved; stopped service remains stopped');
 await run({action:'rollback',id});await wait(id,'restored');assert(await readFile(file,'utf8')===content('before'),'Original configuration was not recovered');assert(await docker([...base,'ps','-q','neighbor'])===before,'Rollback affected neighbor');checks.push('Rollback restores original configuration and pinned image, preserving neighbors');
 const c=crypto.randomUUID(),p=await run({action:'prepare',id:c,path:file,content:content('after')});assert(p.ok,p.error);await writeFile(file,content('concurrent'));await run({action:'apply',id:c});
 let conflict;for(let i=0;i<100;i++){conflict=await run({action:'status',id:c});if(conflict.state==='interrupted')break;await Bun.sleep(100);}assert(conflict.state==='interrupted','Concurrent edit was not blocked');assert(await readFile(file,'utf8')===content('concurrent'),'Concurrent edit was overwritten');checks.push('Concurrent host edit stops publication and remains intact');
 const invalid=await run({action:'prepare',id:crypto.randomUUID(),path:file,content:'services: ['});assert(!invalid.ok,'Invalid YAML enabled');checks.push('Docker invalid YAML fails without host publication');
 await writeFile(file,content('before'));const removal=JSON.parse(content('before'));delete removal.services.selected;
 const retire=crypto.randomUUID(),retirement=await run({action:'prepare',id:retire,path:file,content:JSON.stringify(removal),retire:'selected'});assert(retirement.ok,retirement.error);await run({action:'apply',id:retire});await wait(retire,'verified');assert(await docker(['ps','-aq','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=selected'])==='','Selected retirement left a container');assert(await docker([...base,'ps','-q','neighbor'])===before,'Retirement affected neighbor');assert(await docker([...base,'ps','-q','off'])==='','Retirement started stopped service');checks.push('Selected retirement removes only its Compose declaration and container; neighbor and stopped services preserved');
 await run({action:'rollback',id:retire});await wait(retire,'restored');assert(await docker([...base,'ps','-q','selected'])!=='','Retired service was not recovered');assert(await docker([...base,'ps','-q','neighbor'])===before,'Retirement recovery affected neighbor');assert(await readFile(file,'utf8')===content('before'),'Retirement recovery lost original config');checks.push('Retirement rollback restores configuration and previously running service without removing volumes');
 await writeFile('docs/qa/maintenance-compose-fixture.json',JSON.stringify({at:new Date().toISOString(),fixtureProject:project,checks,realServicesTouched:0,volumesRemoved:0},null,2)+'\n');console.log(JSON.stringify({checks,fixtureOnly:true}));
}finally{
 // Exactly this newly-created project. No wildcard, prune or volume removal.
 try{await docker([...base,'down']);}finally{await rm(home,{recursive:true,force:true});}
}
