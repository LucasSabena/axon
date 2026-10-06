/** Test-only capability: creates and owns its temporary root. Never imported by src/index.ts. */
import { mkdtemp, lstat, readFile, writeFile, statfs, unlink, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Candidate } from '../src/storage/types';
import type { FixtureExecutor } from '../src/storage/service';
import { scanRoot } from '../src/storage/scan';
export async function storageFixture(){
  const dir=await mkdtemp(path.join(tmpdir(),'axon-owned-storage-'));await chmod(dir,0o700);
  const exact=new Map<string,Candidate['identity']>();
  const same=(a:Candidate['identity'],b:Candidate['identity'])=>JSON.stringify(a)===JSON.stringify(b);
  const inspect=async(p:string)=>{const s=await lstat(p,{bigint:true});return {device:String(s.dev),inode:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ownerUid:Number(s.uid),kind:s.isFile()?'file':s.isDirectory()?'directory':'symlink'};};
  const executor:FixtureExecutor={
    async revalidate(c){
      if(path.dirname(c.identity.canonicalPath)!==dir||c.identity.kind!=='file'||!exact.has(c.id)||!same(exact.get(c.id)!,c.identity))return false;
      try{const s=await inspect(c.identity.canonicalPath);return Object.entries(s).every(([k,v])=>c.identity[k]===v);}catch{return false;}
    },
    async execute(c){
      if(!await executor.revalidate(c))throw new Error('Fixture changed');
      // Fixture root is private and exclusively owned by this harness. No host or user paths accepted.
      const before=await statfs(dir,{bigint:true});await unlink(c.identity.canonicalPath);
      const missing=await lstat(c.identity.canonicalPath).then(()=>false,(e)=>e.code==='ENOENT');
      const after=await statfs(dir,{bigint:true});
      return {state:missing?'verified':'interrupted',message:missing?'Se verificó la eliminación de la fixture; diferencia del filesystem medida por separado.':'No se pudo verificar',retiredBytes:c.allocatedBytes||'0',freeBytesBefore:String(before.bavail*before.bsize),freeBytesAfter:String(after.bavail*after.bsize)};
    },
  };
  return {dir,executor,
    async add(name:string,content='fixture-cache'){if(path.basename(name)!==name||name==='.manifest.json')throw new Error('Invalid fixture');await writeFile(path.join(dir,name),content);},
    async scan(){const r=await scanRoot({id:'fixture',path:dir,title:'Fixture de caché',adapterId:'fixture'},[],undefined,(_tool,args)=>['python3',...args]);for(const c of r.candidates){if(c.identity.kind==='file'){c.blockers=[];c.requiredCapabilities=['owned-fixture'];c.risk='rebuildable';c.recovery='regenerate';exact.set(c.id,c.identity);}}return r;},
    async cleanup(){await rm(dir,{recursive:true,force:true});},
  };
}
