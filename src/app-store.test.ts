import {test,expect} from 'bun:test';
import {STORE_APPS,storeSteps} from './app-store';
import '../public/themes.js';
import {Hono} from 'hono';
import {registerStoreRoutes,removalSimulation} from './app-store';
test('APT preview retains all removals, including dependencies; legacy remove cannot bypass the durable executor',async()=>{
 expect(removalSimulation('Remv ffmpeg [1]\nRemv libexample:amd64 [2]\nInst replacement (3)\n')).toEqual({removed:['ffmpeg','libexample:amd64'],installed:['replacement']});
 const app=new Hono();registerStoreRoutes(app);const r=await app.request('/api/store/ffmpeg/remove',{method:'POST'});expect(r.status).toBe(409);expect((await r.json()).preview).toBe('/api/store/ffmpeg/removal-preview');
});

test('system store recipes install on the host with fixed package names and retain user data on removal',()=>{
 expect(new Set(STORE_APPS.map(a=>a.id)).size).toBe(STORE_APPS.length);
 expect(STORE_APPS.length).toBeGreaterThanOrEqual(25);
 const blender=STORE_APPS.find(a=>a.id==='blender')!,godot=STORE_APPS.find(a=>a.id==='godot')!;
 for(const app of [blender,godot]){
  const steps=storeSteps(app,'install');expect(steps.every(s=>s.user==='root'&&s.group==='store')).toBe(true);
  expect(steps.at(-1)?.cmd).toContain('flatpak install --system');expect(steps.at(-1)?.cmd).toContain(app.package);
  const remove=storeSteps(app,'remove');expect(remove.length).toBe(1);expect(remove[0].cmd).not.toContain('--delete-data');
 }
 expect(()=>storeSteps(STORE_APPS.find(a=>a.id==='davinci')!,'install')).toThrow('fabricante');
 expect(storeSteps(STORE_APPS.find(a=>a.id==='ffmpeg')!,'remove')[0].cmd).toContain('apt-get remove');
});
function luminance(hex:string){const rgb=hex.slice(1).match(/../g)!.map(x=>parseInt(x,16)/255).map(x=>x<=0.04045?x/12.92:((x+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a:string,b:string){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('20 complete appearance presets have readable text and distinct geometry / fonts',()=>{
 const {presets}=(globalThis as any).AxonThemes;
 for(const mode of ['light','dark'])expect(presets.filter((t:any)=>t.mode===mode).length).toBeGreaterThanOrEqual(10);
 expect(new Set(presets.map((t:any)=>t.id)).size).toBe(20);
 for(const t of presets){
  for(const field of ['font-sans','font-mono','row-pad-y','radius','shadow-modal','header-h','sidebar-w'])expect(t.tokens[field]).toBeTruthy();
  for(const bg of ['bg-canvas','bg-panel','bg-elevated']){
   expect(contrast(t.tokens.text,t.tokens[bg])).toBeGreaterThanOrEqual(4.5);
   expect(contrast(t.tokens['text-dim'],t.tokens[bg])).toBeGreaterThanOrEqual(4.5);
  }
  expect(contrast(t.tokens.accent,t.tokens['accent-contrast'])).toBeGreaterThanOrEqual(4.5);
 }
 expect(new Set(presets.map((t:any)=>t.tokens['font-sans'])).size).toBeGreaterThanOrEqual(4);
 expect(new Set(presets.map((t:any)=>t.tokens.radius)).size).toBeGreaterThanOrEqual(8);
});
