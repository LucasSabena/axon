import {ICON_PROVIDERS,parseIconCatalog,type IconProvider} from '../src/software-icon-catalog';
import {writeFile} from 'node:fs/promises';
const icons=[];
for(const [provider,cfg] of Object.entries(ICON_PROVIDERS)){
 const commit=await fetch(`https://api.github.com/repos/${cfg.repo}/commits/${cfg.branch}`,{headers:{'User-Agent':'AXON-icon-catalog'},signal:AbortSignal.timeout(20000)});
 if(!commit.ok)throw Error('Cannot read revision: '+provider);const revision=(await commit.json()).sha;
 if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Invalid revision');
 const r=await fetch(`https://raw.githubusercontent.com/${cfg.repo}/${revision}/${cfg.index}`,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Cannot read catalog: '+provider);
 icons.push(...parseIconCatalog(provider as IconProvider,revision,await r.json()));
}
await writeFile('src/software-icon-catalog.json',JSON.stringify({version:1,updatedAt:new Date().toISOString(),icons})+'\n');
console.log(JSON.stringify({icons:icons.length,providers:Object.keys(ICON_PROVIDERS)}));
