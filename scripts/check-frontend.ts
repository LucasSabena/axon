import { readdir } from 'node:fs/promises';
const files=(await readdir('public')).filter(f=>f.endsWith('.js'));
for(const file of files){const p=Bun.spawn(['node','--check',`public/${file}`],{stdout:'inherit',stderr:'inherit'});if(await p.exited)process.exit(1);}
console.log(`Frontend syntax checked: ${files.length} files`);
