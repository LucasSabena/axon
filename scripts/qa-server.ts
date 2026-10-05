import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import * as path from 'node:path';

// Temporary app data, independent signing secret, no production dotenv/Cloudflare credentials.
const dir=await mkdtemp(path.join(tmpdir(),'axon-polish-qa-'));
await writeFile(path.join(dir,'.axon-qa-owned'),'isolated-qa-v1',{mode:0o600});
await mkdir(path.join(dir,'scan-fixture'));
await writeFile(path.join(dir,'scan-fixture','cache-demo.bin'),new Uint8Array(32768));
await writeFile(path.join(dir,'scan-fixture','nota.txt'),'Fixture de QA. No es un archivo personal.');
const env={...process.env,AXON_QA_ROOT:dir,AXON_PUBLIC_ORIGIN:'http://127.0.0.1:3459',CONFIG_PATH:path.join(dir,'config.json'),PORT:'3459',AXON_BIND_HOST:'127.0.0.1',HOST_USER:userInfo().username,PROJECT_SCAN_DIRS:dir,SESSION_SECRET:crypto.randomUUID()};
for(const key of Object.keys(env))if(/^(CLOUDFLARE_|CF_)/.test(key))delete (env as Record<string,string|undefined>)[key];
process.env.SESSION_SECRET=env.SESSION_SECRET;
const {hashPassword}=await import('../src/auth');
await mkdir(path.join(dir,'media'),{recursive:true});await mkdir(path.join(dir,'library'));
const legacy=path.join(dir,'.local/share/axon-trash');await mkdir(legacy,{recursive:true,mode:0o700});
await writeFile(path.join(legacy,'legacy-note'),'Nota temporal para probar la migración de papelera.');
await mkdir(path.join(legacy,'legacy-project'));await writeFile(path.join(legacy,'legacy-project','source.txt'),'Original de fixture que debe conservarse.');
await writeFile(path.join(legacy,'.manifest.json'),JSON.stringify(['legacy-note','legacy-project'].map(id=>({id,orig:path.join(dir,'media',id),ts:Date.now()-86400000}))));
await writeFile(env.CONFIG_PATH,JSON.stringify({auth:{username:'qa',passwordHash:await hashPassword('axon-local-qa')},domains:[],projects:[],settings:{hostUser:env.HOST_USER,scanDirs:[dir],scanIntervalMs:5000}}));
await writeFile(path.join(dir,'library/state.json'),JSON.stringify({roots:[path.join(dir,'media')],uploadRoot:path.join(dir,'media'),shareBase:'',favorites:[],collections:[],shares:[]}));
console.log(`QA: http://127.0.0.1:3459 | usuario qa | contraseña axon-local-qa | datos ${dir}`);
console.log('QA aislado: operaciones de host y WebSockets bloqueados por backend. Almacenamiento y operaciones de archivos sólo modifican fixtures propias.');
const child=Bun.spawn(['bun','--no-env-file','run','src/index.ts'],{stdout:'inherit',stderr:'inherit',env});
const stop=()=>child.kill('SIGTERM');process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{process.exitCode=await child.exited;}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);await rm(dir,{recursive:true,force:true});}
