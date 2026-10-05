import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
if(existsSync('/hostfs/etc/hostname'))throw new Error('Run tests on the host or in a standalone image without /hostfs; fixture paths must share the command filesystem.');
const dir=await mkdtemp(path.join(tmpdir(),'axon-test-'));
try {
  const child=Bun.spawn(['bun','test',...process.argv.slice(2)],{stdout:'inherit',stderr:'inherit',env:{...process.env,CONFIG_PATH:path.join(dir,'config.json'),OPTIMIZER_AUDIT_PATH:path.resolve('scripts/fixtures/optimizer-audit.json')}});
  process.exitCode=await child.exited;
} finally { await rm(dir,{recursive:true,force:true}); }
