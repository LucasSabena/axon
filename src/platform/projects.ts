import { open, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { hostToContainer, hostExec } from '../host';
import type { Project,PortProcess,DomainMapping } from '../types';
import { PlatformError, type PlatformStore } from './store';

export interface HubContainer {
  id: string; name: string; image: string; state: string; health: string | null; ports: number[];
  composeProject?: string; service?: string; workingDir?: string; configFiles: string[];
  mounts: {source:string;destination:string;type:string}[]; dependsOn: string[];
}
export interface HubBindings { containers: string[]; domains: string[] }
export interface HubSources {
  projects: () => Project[]; processes: () => Promise<PortProcess[]>; containers: () => Promise<HubContainer[]>;
  domains: () => DomainMapping[]; home: () => Promise<string>;
  chats: (home:string,cwd:string) => Promise<any>; consumption: (home:string,cwd:string) => Promise<any>;
  terminals?: () => Promise<{name:string;cwd:string}[]>;
}
export async function hubTerminals() {
  const result=await hostExec("tmux list-panes -a -F '#{session_name}\t#{pane_current_path}'",{user:'user',timeoutMs:4000});
  if(!result.ok){if(/no server running|failed to connect|error connecting.*No such file/i.test(result.stderr))return [];throw new Error('Terminales no disponibles');}
  return result.stdout.split('\n').filter(Boolean).slice(0,200).map(line=>{const [name,cwd]=line.split('\t');return {name,cwd};}).filter(t=>t.name&&t.cwd);
}
export function inside(candidate: string,root: string): boolean {
  if (!candidate || !root || !path.isAbsolute(candidate) || !path.isAbsolute(root)) return false;
  const rel = path.relative(path.normalize(root),path.normalize(candidate));
  return rel === '' || (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export function relate(project: Project, processes: PortProcess[], containers: HubContainer[], domains: DomainMapping[], bindings: HubBindings = {containers:[],domains:[]}) {
  const proc = processes.filter(p => inside(p.identity.projectRoot || p.cwd,project.cwd));
  const dock = containers.filter(c => bindings.containers.includes(c.id) || inside(c.workingDir || '',project.cwd) || c.configFiles.some(f => inside(f,project.cwd)) || c.mounts.some(m => inside(m.source,project.cwd)));
  const ports = new Set([...(project.port ? [project.port] : []),...proc.flatMap(p => p.ports),...dock.flatMap(c => c.ports)]);
  const dom = domains.filter(d => bindings.domains.includes(d.id) || d.projectName === project.name || (d.port > 0 && ports.has(d.port)));
  return {
    processes:proc.map(p => ({pid:p.pid,name:p.name,ports:p.ports,memoryMb:p.memoryMb,uptimeSeconds:p.uptimeSeconds,cwd:p.cwd,protected:p.identity.protected})),
    containers:dock.map(c => ({...c,relation:bindings.containers.includes(c.id) ? 'manual' : 'filesystem'})),
    domains:dom.map(d => ({...d,relation:bindings.domains.includes(d.id) ? 'manual' : d.projectName === project.name ? 'registered-name' : 'port'})),
    ports:[...ports],
  };
}
export async function hubContainers(): Promise<HubContainer[]> {
  const child = Bun.spawn(['docker','ps','-aq','--no-trunc'],{stdout:'pipe',stderr:'pipe'});
  const listTimer = setTimeout(() => child.kill(),15000);
  let listed: [string,string,number];
  try { listed = await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]); }
  finally { clearTimeout(listTimer); }
  const [raw,,code] = listed;
  if (code) throw new Error('Docker no disponible');
  const ids = raw.trim().split('\n').filter(Boolean);
  if (!ids.length) return [];
  if (ids.length > 500) throw new Error('Inventario Docker excedido');
  const p = Bun.spawn(['docker','inspect',...ids],{stdout:'pipe',stderr:'pipe'});
  const timer = setTimeout(() => p.kill(),15000);
  try {
    const [out,,exit] = await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);
    if (exit || out.length > 16_000_000) throw new Error('Inventario Docker incompleto');
    return JSON.parse(out).map((c:any) => {
      const labels = c.Config?.Labels || {};
      return {id:c.Id,name:(c.Name || '').replace(/^\//,''),image:c.Config?.Image || '',state:c.State?.Status || 'unknown',health:c.State?.Health?.Status || null,
        ports:[...new Set(Object.values(c.NetworkSettings?.Ports || {}).flatMap((v:any) => (v || []).map((b:any) => Number(b.HostPort))).filter(Boolean))],
        composeProject:labels['com.docker.compose.project'],service:labels['com.docker.compose.service'],workingDir:labels['com.docker.compose.project.working_dir'],
        configFiles:(labels['com.docker.compose.project.config_files'] || '').split(',').filter(Boolean),
        mounts:(c.Mounts || []).map((m:any) => ({source:m.Source,destination:m.Destination,type:m.Type})),
        dependsOn:(labels['com.docker.compose.depends_on'] || '').split(',').filter(Boolean).map((v:string) => v.split(':')[0])};
    });
  } finally { clearTimeout(timer); }
}
export class ProjectHub {
  constructor(readonly store: PlatformStore,readonly sources: HubSources) {}
  project(id: string) { const p = this.sources.projects().find(p => p.id === id); if (!p) throw new PlatformError('Proyecto no encontrado',404); return p; }
  async resources(id: string) {
    const project = this.project(id), warnings: string[] = [];
    const [p,c] = await Promise.allSettled([this.sources.processes(),this.sources.containers()]);
    if (p.status === 'rejected') warnings.push('No se pudieron consultar los procesos.');
    if (c.status === 'rejected') warnings.push('No se pudieron consultar los contenedores.');
    const bindings = this.store.get<HubBindings>('bindings',id) || {containers:[],domains:[]};
    return {project,...relate(project,p.status === 'fulfilled' ? p.value : [],c.status === 'fulfilled' ? c.value : [],this.sources.domains(),bindings),bindings,warnings,
      coverage:{processes:p.status === 'fulfilled',containers:c.status === 'fulfilled'},observedAt:new Date().toISOString()};
  }
  async overview(id: string) {
    const resources = await this.resources(id), cwd = resources.project.cwd;
    const home = await this.sources.home();
    const [files,chats,consumption,docs,terminals] = await Promise.allSettled([
      readdir(hostToContainer(cwd),{withFileTypes:true}).then(entries => entries.slice(0,100).map(e => ({name:e.name,directory:e.isDirectory(),symlink:e.isSymbolicLink()}))),
      this.sources.chats(home,cwd),this.sources.consumption(home,cwd),
      Promise.all(['AGENTS.md','CLAUDE.md','README.md','README'].map(async name => {
        try { const file = await open(hostToContainer(path.join(cwd,name)),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{if(!(await file.stat()).isFile())return null;const buffer=Buffer.alloc(4000);const {bytesRead}=await file.read(buffer,0,buffer.length,0);return {name,path:path.join(cwd,name),excerpt:buffer.subarray(0,bytesRead).toString('utf8').slice(0,2000)};}finally{await file.close();} }
        catch { return null; }
      })).then(entries => entries.filter(Boolean)),
      this.sources.terminals ? this.sources.terminals().then(rows=>rows.filter(t=>inside(t.cwd,cwd))) : Promise.resolve([]),
    ]);
    const warnings = [...resources.warnings];
    for (const [label,result] of [['archivos',files],['chats',chats],['consumo',consumption],['documentación',docs],['terminales',terminals]] as const) if (result.status === 'rejected' || result.status === 'fulfilled' && result.value?.ok === false) warnings.push(`No se pudo actualizar ${label}.`);
    return {...resources,warnings,files:files.status === 'fulfilled' ? files.value : null,chats:chats.status === 'fulfilled' ? chats.value : null,
      consumption:consumption.status === 'fulfilled' ? consumption.value : null,documents:docs.status === 'fulfilled' ? docs.value : null,terminals:terminals.status === 'fulfilled' ? terminals.value : null,
      activity:this.store.audit(id).entries,links:{files:`/archivos?path=${encodeURIComponent(cwd)}`,terminal:`/terminal?project=${encodeURIComponent(id)}`,chats:`/agentes?id=__chats&project=${encodeURIComponent(cwd)}`}};
  }
  async bind(id: string,input: any,actor: string) {
    this.project(id);
    if (!input || Object.keys(input).some(k => !['containers','domains'].includes(k)) || !Array.isArray(input.containers) || !Array.isArray(input.domains) || input.containers.length > 100 || input.domains.length > 100) throw new PlatformError('Asociaciones inválidas');
    const containers = await this.sources.containers(), domains = this.sources.domains();
    if (input.containers.some((v:any) => !containers.some(c => c.id === v)) || input.domains.some((v:any) => !domains.some(d => d.id === v))) throw new PlatformError('Recurso no encontrado');
    const bindings = {containers:[...new Set<string>(input.containers)],domains:[...new Set<string>(input.domains)]};
    this.store.put('bindings',id,bindings);this.store.append({actor,action:'project.bind',resource:id,projectId:id,status:'ok'});return bindings;
  }
}
