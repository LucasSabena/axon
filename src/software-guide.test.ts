import {describe,test,expect} from 'bun:test';
import {softwareFolder,softwareRisk} from './software-guide';
const row=(o:Record<string,unknown>)=>({manager:'apt',kind:'application',packageName:'tool',name:'Tool',...o}) as any;
describe('automatic folders',()=>{
 test('desktop categories pick the folder, specific categories first',()=>{
  expect(softwareFolder(row({categories:['Graphics','3DGraphics']}))).toBe('Gráficos y diseño');
  expect(softwareFolder(row({categories:['Utility','TextEditor','Development','IDE']}))).toBe('Desarrollo');
  expect(softwareFolder(row({categories:['GNOME','GTK','Network','WebBrowser']}))).toBe('Internet y comunicación');
 });
 test('AI assistants are grouped by name even without categories',()=>{
  expect(softwareFolder(row({manager:'pnpm',kind:'tool',packageName:'@anthropic-ai/claude-code',name:'Claude Code'}))).toBe('IA y agentes');
  expect(softwareFolder(row({packageName:'chatgpt',name:'ChatGPT',categories:['Utility']}))).toBe('IA y agentes');
 });
 test('terminal tools and system pieces fall back by origin and kind',()=>{
  expect(softwareFolder(row({manager:'pnpm',kind:'tool',packageName:'vercel',name:'vercel'}))).toBe('Desarrollo');
  expect(softwareFolder(row({manager:'manual',kind:'tool',packageName:'btop',name:'btop'}))).toBe('Herramientas de terminal');
  expect(softwareFolder(row({manager:'flatpak',kind:'runtime',packageName:'runtime/org.freedesktop.Platform/x86_64/25.08'}))).toBe('Componentes del sistema');
  expect(softwareFolder(row({manager:'manual',kind:'application'}))).toBe('Otros');
 });
});
describe('system update risk',()=>{
 test('programs carry no system risk',()=>expect(softwareRisk(row({}))).toBeUndefined());
 test('system pieces with a desktop entry still count as system',()=>expect(softwareRisk(row({kind:'application',packageName:'gnome-shell',name:'Extensions'}))?.group).toBe('gnome'));
 test('kernel, GPU driver and Docker are delicate',()=>{
  for(const name of ['linux-image-7.0.0-40-generic','libxnvctrl0:amd64','docker-ce'])expect(softwareRisk(row({kind:'dependency',packageName:name}))?.level).toBe('careful');
 });
 test('a binary package family is grouped by its source package',()=>{
  const a=softwareRisk(row({kind:'dependency',packageName:'libsss-idmap0',sourceName:'sssd'})),b=softwareRisk(row({kind:'dependency',packageName:'python3-sss',sourceName:'sssd'}));
  expect(a?.group).toBe('sssd');expect(b?.group).toBe('sssd');expect(a?.level).toBe('review');
 });
 test('unknown libraries and shared Flatpak runtimes are safe with an explanation',()=>{
  const lib=softwareRisk(row({kind:'dependency',packageName:'libfoo1',sourceName:'foo'}));expect(lib?.level).toBe('safe');expect(lib?.detail).toContain('seguridad');
  expect(softwareRisk(row({manager:'flatpak',kind:'runtime',packageName:'runtime/org.freedesktop.Sdk/x86_64/25.08'}))?.group).toBe('flatpak-runtime');
 });
});
