import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SoftwareIcons} from '../src/software-icons';
const file=process.argv[2];if(!file)throw Error('Provide a native inventory JSON file');
const snapshot=JSON.parse(await readFile(file,'utf8')),dir=await mkdtemp(path.join(tmpdir(),'axon-icons-seed-')),icons=new SoftwareIcons(dir);
try{
 const result=await icons.warm(snapshot.installations);
 await writeFile('src/software-icon-seed.json',JSON.stringify({assets:icons.exportAssets()})+'\n');
 console.log(JSON.stringify({coverage:icons.status(snapshot.installations),...result,unbrandedTools:snapshot.installations.filter((p:any)=>['application','tool','package'].includes(p.kind)&&icons.describe(p).kind==='type').map((p:any)=>p.packageName)}));
}finally{icons.close();await rm(dir,{recursive:true,force:true});}
