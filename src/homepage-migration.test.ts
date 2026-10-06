import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {MaintenanceRepository} from './storage/repository';
import {Migrations} from './app-migrations';
import {HomeLinks,importHomepage} from './home-links';
import {HomepageMigration} from './homepage-migration';
const actor={actorId:'fixture',sessionId:'fixture'};
test('Homepage import freezes config revision, preserves personalizations and never imports widget credentials',async()=>{
 const root=await mkdtemp(tmpdir()+'/axon-homepage-fixture-'),repo=new MaintenanceRepository(root+'/ledger');
 try{const links=new HomeLinks(repo);links.importLinks([{name:'Personalizado',url:'https://existing.test',favorite:true,group:'Personal'}],links.get().revision);const migrations=new Migrations(repo,async()=>[{id:'fixture',name:'homepage',backend:'docker',scope:'fixture',version:null,executablePath:null,coverage:'fixture',references:[],blockers:[],container:{id:'fixture',project:'fixture',service:'homepage',state:'running',image:'homepage:fixture',mounts:[],configFiles:[]}}]);let revision='one';const sources=async()=>[{file:'services.yaml',revision,...importHomepage('- Grupo:\n  - Existente:\n      href: https://existing.test\n  - Nuevo:\n      href: https://new.test/?token=fixture-private\n      widget:\n        password: fixture-private\n')}];const service=new HomepageMigration(migrations,links,sources),plan=await service.preview(actor);expect(JSON.stringify(plan)).not.toContain('fixture-private');await expect(service.execute(plan.id,plan.digest,{...actor,sessionId:'other'})).rejects.toThrow();revision='two';await expect(service.execute(plan.id,plan.digest,actor)).rejects.toThrow('Cambió');revision='one';await service.execute(plan.id,plan.digest,actor);await service.execute(plan.id,plan.digest,actor);expect(links.get().links.length).toBe(2);expect(links.get().links[0].name).toBe('Personalizado');expect(links.get().links[0].favorite).toBe(true);expect(repo.get<any>('migration','homepage').state).toBe('imported');}finally{repo.close();await rm(root,{recursive:true,force:true});}
});
