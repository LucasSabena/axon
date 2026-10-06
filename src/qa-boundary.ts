import type { Hono } from 'hono';
import { lstat,readFile,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export async function qaRoot():Promise<string|null>{
 const input=process.env.AXON_QA_ROOT;if(!input)return null;
 const resolved=await realpath(input);const s=await lstat(input);
 if(resolved!==input||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)||path.dirname(input)!==tmpdir()||!path.basename(input).startsWith('axon-polish-qa-'))throw new Error('QA necesita una fixture privada y dedicada');
 if((await readFile(path.join(input,'.axon-qa-owned'),'utf8'))!=='isolated-qa-v1')throw new Error('QA sin marcador de propiedad');
 if(path.dirname(process.env.CONFIG_PATH||'')!==input)throw new Error('QA no puede usar configuración externa');
 return input;
}
export function registerQaBoundary(app:Hono,root:string|null){
 if(!root)return;
 app.use('*',async(c,next)=>{
  const p=c.req.path;
  if(p.startsWith('/p/')||p.startsWith('/ws/')||p.startsWith('/api/browser'))return c.json({ok:false,error:'QA: acceso operativo bloqueado'},403);
  if(!['GET','HEAD'].includes(c.req.method)){
   const safe=/^\/api\/(login|logout|home\/links|home\/import(?:-preview)?|storage\/scans(?:\/[^/]+\/cancel)?|storage\/exclusions|storage\/plans|maintenance\/migrations\/[^/]+\/(compare|evidence))$/.test(p);
   // These operations only consume server-side items from the owned QA home.
   // The QA server exposes no writable route capable of changing their metadata.
   const fixtureFile=/^\/api\/files\/(create|write|mkdir|rename|copy|trash|restore|upload(?:\/init|\/[^/]+(?:\/finish)?)?)$/.test(p);
   const fixtureTransfer=/^\/api\/(files\/(transfers(?:\/plans|\/[^/]+\/(?:execute|recover))?|copyjob(?:\/[^/]+)?)|storage\/plans\/[^/]+\/(execute|cancel|recover))$/.test(p);
   const fixtureTrash=/^\/api\/storage\/trash\/(restore|migration-plans(?:\/[^/]+\/(?:execute|recover))?)$/.test(p);
   const fixtureLibrary=/^\/api\/library\/(favorite|shares|collections|rescan|settings)$/.test(p);
   const fixtureProject=/^\/api\/projects$/.test(p);
   const fixtureAgentDoc=p==='/api/agent-docs/create';
   // Account metadata and launcher writes use the QA-owned home. Logins remain
   // blocked: they would run real agent binaries and contact external accounts.
   const fixtureAccounts=/^\/api\/agent-accounts\/(codex|claude)(?:\/(activate|rename|install))?$/.test(p);
   const fixturePlatform=/^\/api\/(access\/tokens(?:\/[^/]+)?|project-hub\/[^/]+\/(diagnose|bindings)|backups\/(policies(?:\/[^/]+\/run)?|jobs\/[^/]+\/(restore|verify)))$/.test(p);
   if(!safe&&!fixtureTrash&&!fixtureTransfer&&!fixtureFile&&!fixtureLibrary&&!fixtureAccounts&&!fixturePlatform&&!fixtureProject&&!fixtureAgentDoc)return c.json({ok:false,error:'QA: mutación de host bloqueada por el servidor; usá pruebas con fixtures inyectadas'},403);
  }
  await next();
 });
}
