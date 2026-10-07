import type { HttpFetch } from './http-fetch';
import {test,expect} from 'bun:test';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SoftwareIcons,validateIcon,typeIcon} from './software-icons';
import {parseIconCatalog} from './software-icon-catalog';
const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#123456" d="M1 1h10v10z"/></svg>';
async function registry(fn:(icons:SoftwareIcons)=>Promise<void>,fetcher:HttpFetch=async()=>new Response(svg)){
 const dir=await mkdtemp(path.join(tmpdir(),'axon-icons-test-')),icons=new SoftwareIcons(dir,fetcher,{});try{await fn(icons);}finally{icons.close();await rm(dir,{recursive:true,force:true});}
}
test('an installed application absent from the previous icon map matches the external catalog',()=>registry(async icons=>{
 const info=icons.describe({packageName:'rclone',name:'rclone',kind:'tool'});expect(info.kind).toBe('logo');expect(info.catalogId).toBeTruthy();expect(info.sourceUrl).toStartWith('https://');
 expect(icons.describe({packageName:'app/org.blender.Blender/x86_64/stable',name:'Blender',applicationId:'org.blender.Blender',kind:'application'}).catalogId).toBe('selfhst:blender');
}));
test('dependencies and local scripts never claim another product identity from fuzzy matching',()=>registry(async icons=>{
 expect(icons.describe({packageName:'python3-blinker',name:'python3-blinker',kind:'dependency'}).kind).toBe('project');
 expect(icons.describe({packageName:'not-really-firefox',name:'not-really-firefox',kind:'tool'}).kind).toBe('type');
 expect(icons.describe({packageName:'proton',name:'proton',manager:'manual',kind:'tool'}).kind).toBe('type');
 expect(icons.describe({packageName:'linux',name:'linux',kind:'package'}).catalogId).not.toBe('dashboard:gnu-guix');
 const unknown=typeIcon({packageName:'local-script.sh',name:'Local script',kind:'tool'});expect(unknown).toContain('<path');expect(unknown).not.toContain('<text');
}));
test('one download is shared across installations and survives restart without network',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-icons-persistent-'));let calls=0;let icons=new SoftwareIcons(dir,async()=>{calls++;await Bun.sleep(10);return new Response(svg);},{});
 try{await Promise.all([icons.asset('simpleicons:curl'),icons.asset('simpleicons:curl')]);expect(calls).toBe(1);icons.close();icons=new SoftwareIcons(dir,async()=>{throw Error('offline');});expect((await icons.asset('simpleicons:curl')).mime).toBe('image/svg+xml');expect(calls).toBe(1);}finally{icons.close();await rm(dir,{recursive:true,force:true});}
});
test('manual choices survive restart and can be reset to native discovery',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-icon-choice-'));let icons=new SoftwareIcons(dir);const row={id:'installation-one',packageName:'unknown-app',name:'Unknown app',iconFile:'/tmp/native.svg',kind:'application'};
 try{icons.setChoice(row,'selfhst:blender');icons.close();icons=new SoftwareIcons(dir);expect(icons.describe(row).catalogId).toBe('selfhst:blender');icons.setChoice(row,null);expect(icons.describe(row).provider).toBe('desktop');expect(()=>icons.setChoice(row,'https://internal/icon')).toThrow('Unknown catalog');}finally{icons.close();await rm(dir,{recursive:true,force:true});}
});
test('invalid SVGs and images cannot introduce network references or active content',()=>{
 for(const attack of ['<script>alert(1)</script>','<image href="https://internal/private.png"/>','<use href="file:///etc/passwd"/>','<rect onload="alert(1)"/>','<style>path{fill:url(https://internal)}</style>','<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'])expect(()=>validateIcon(Buffer.from(svg.replace('<path',attack+'<path')),'svg')).toThrow();
 expect(()=>validateIcon(Buffer.from('<html>error</html>'),'svg')).toThrow();expect(()=>validateIcon(Buffer.from('not-png'),'png')).toThrow();expect(()=>validateIcon(Buffer.from(svg),'svg')).not.toThrow();
});
test('uploaded logos survive restart, reject active content, and reset cleanly',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-icon-upload-'));let icons=new SoftwareIcons(dir);const row={id:'owned-fixture',packageName:'owned-local-tool',name:'Local tool',kind:'tool'};
 try{icons.upload(row,Buffer.from(svg),'svg');icons.close();icons=new SoftwareIcons(dir);expect(icons.describe(row).label).toContain('subido');const response=await icons.response(row);expect(await response.text()).toContain('fill="#123456"');expect(()=>icons.upload(row,Buffer.from(svg.replace('<path','<script>alert(1)</script><path')),'svg')).toThrow();icons.setChoice(row,null);expect(icons.describe(row).kind).toBe('type');}finally{icons.close();await rm(dir,{recursive:true,force:true});}
});
test('native logos are reused only by exact related identities',()=>registry(async icons=>{
 icons.learnNative([{packageName:'an-app.desktop',name:'An App',kind:'application',iconFile:'/native/app.png'}]);expect(icons.describe({packageName:'@an-app/cli',name:'An App',kind:'tool'}).kind).toBe('project');expect(icons.describe({packageName:'unrelated-app',name:'Another App',kind:'tool'}).kind).toBe('type');
}));
test('invalid catalogs never replace usable data and aliases do not become automatic identities',()=>registry(async icons=>{
 const before=icons.status().catalog;expect(before).toBeGreaterThan(9000);expect(()=>parseIconCatalog('selfhst','bad',[])).toThrow();expect(()=>parseIconCatalog('selfhst','a'.repeat(40),[])).toThrow();expect(icons.status().catalog).toBe(before);
}));
test('network failure still yields a declared type icon and short cache lifetime',()=>registry(async icons=>{
 const r=await icons.response({packageName:'curl',name:'curl',kind:'tool'});expect(r.headers.get('X-Axon-Icon-Kind')).toBe('type');expect(r.headers.get('Cache-Control')).toContain('max-age=60');expect(await r.text()).not.toContain('<text');
},async()=>{throw Error('offline');}));
test('remote fetching is bounded and uses only fixed catalog URLs',()=>registry(async icons=>{
 const ids=['simpleicons:curl','simpleicons:ffmpeg','simpleicons:gnome','simpleicons:llvm','simpleicons:gnu','simpleicons:uv'];await Promise.all(ids.map(id=>icons.asset(id)));expect(icons.status().assets).toBe(ids.length);
},async(url)=>{expect(String(url)).toStartWith('https://raw.githubusercontent.com/');expect(String(url)).not.toContain('unknown-app');return new Response(svg);}));

test('native images use their actual content type even when a desktop theme has the wrong extension',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'axon-native-image-'));const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');const file=path.join(dir,'incorrect.svg');await writeFile(file,png);const icons=new SoftwareIcons(path.join(dir,'cache'));
 try{const response=await icons.response({packageName:'owned-fixture',name:'Fixture',iconFile:file,kind:'application'},file);expect(response.headers.get('Content-Type')).toBe('image/png');expect(Buffer.from(await response.arrayBuffer())).toEqual(png);}finally{icons.close();await rm(dir,{recursive:true,force:true});}
});
