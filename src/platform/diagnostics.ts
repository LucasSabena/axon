import { stat } from 'node:fs/promises';
import { hostToContainer } from '../host';
import type { ProjectHub } from './projects';
import { PlatformError } from './store';

export interface DiagnosticCheck { key: string; label: string; state:'pass'|'fail'|'warn'|'unknown'|'info'; detail:string; ms?:number }
export interface ProbeResult { ok:boolean; status?:number; ms:number; error?:string }
export async function httpProbe(url: string): Promise<ProbeResult> {
  const start = performance.now();
  try {
    const response = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(5000)});
    await response.body?.cancel();
    return {ok:response.status >= 200 && response.status < 400,status:response.status,ms:Math.round(performance.now()-start)};
  } catch { return {ok:false,ms:Math.round(performance.now()-start),error:'Sin respuesta HTTP dentro de cinco segundos'}; }
}
export async function tcpProbe(port: number): Promise<ProbeResult> {
  const start = performance.now();
  return new Promise(resolve => {
    let done = false;
    const finish = (ok:boolean) => { if (done) return; done = true; clearTimeout(timer); resolve({ok,ms:Math.round(performance.now()-start),...(!ok ? {error:'Sin conexión TCP local'} : {})}); };
    const timer = setTimeout(() => finish(false),3000);
    Bun.connect({hostname:'127.0.0.1',port,socket:{open(socket){socket.end();finish(true);},data(){},error(){finish(false);},close(){finish(false);}}}).catch(() => finish(false));
  });
}
export class Diagnostics {
  private running = new Map<string,Promise<any>>();
  constructor(readonly hub: ProjectHub,private probes = {http:httpProbe,tcp:tcpProbe}) {}
  run(id: string,actor: string,credentialId?:string) {
    this.hub.project(id);
    const key = `${actor}:${credentialId || ''}:${id}`;
    if (this.running.has(key)) return this.running.get(key)!;
    const promise = this.inspect(id,actor,credentialId).finally(() => this.running.delete(key));
    this.running.set(key,promise);return promise;
  }
  private async inspect(id: string,actor: string,credentialId?:string) {
    const data = await this.hub.resources(id), checks: DiagnosticCheck[] = [];
    const add = (key:string,label:string,state:DiagnosticCheck['state'],detail:string,ms?:number) => checks.push({key,label,state,detail,...(ms === undefined ? {} : {ms})});
    try { const s = await stat(hostToContainer(data.project.cwd));add('files','Carpeta del proyecto',s.isDirectory() ? 'pass' : 'fail',s.isDirectory() ? 'La carpeta existe y se puede consultar.' : 'La ruta no es una carpeta.'); }
    catch { add('files','Carpeta del proyecto','fail','La carpeta no está disponible o faltan permisos.'); }
    add('process','Proceso',!data.coverage.processes ? 'unknown' : data.processes.length ? 'pass' : 'info',!data.coverage.processes ? 'La lectura de procesos falló.' : data.processes.length ? `${data.processes.length} proceso(s) relacionado(s).` : 'No se detectaron procesos con puertos. Puede estar detenido o ejecutar tareas sin listener.');
    for (const port of data.ports.slice(0,20)) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new PlatformError('Puerto registrado inválido');
      const result = await this.probes.tcp(port);add(`port:${port}`,`Puerto local :${port}`,result.ok ? 'pass' : 'fail',result.ok ? 'Acepta conexiones TCP locales.' : result.error || 'No responde.',result.ms);
    }
    if (!data.ports.length) add('ports','Puertos','info','El proyecto no tiene un puerto registrado ni listeners detectados.');
    if (!data.coverage.containers) add('docker','Docker','unknown','No se pudo consultar Docker.');
    for (const container of data.containers) {
      add(`docker:${container.id}`,container.name,container.state !== 'running' ? 'warn' : container.health === 'unhealthy' ? 'fail' : container.health === 'starting' ? 'warn' : 'pass',`${container.state}${container.health ? ' · healthcheck '+container.health : ' · sin healthcheck; el estado running no prueba respuesta de la aplicación'}`);
    }
    if (data.coverage.containers && !data.containers.length) add('docker','Contenedores','info','Sin contenedores vinculados. Podés asociarlos desde el proyecto.');
    const all = await this.hub.sources.containers().catch(() => null);
    for (const c of data.containers) for (const service of c.dependsOn) {
      const dependency = all?.find(d => d.composeProject === c.composeProject && d.service === service);
      add(`dependency:${c.id}:${service}`,`Dependencia: ${service}`,!all ? 'unknown' : !dependency ? 'unknown' : dependency.state === 'running' && dependency.health !== 'unhealthy' ? 'pass' : 'fail',!dependency ? 'No se pudo resolver la dependencia declarada.' : `${dependency.name}: ${dependency.state}${dependency.health ? ' · '+dependency.health : ''}`);
    }
    for (const domain of data.domains.slice(0,10)) {
      if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain.fullDomain) || domain.fullDomain.includes('..')) {
        add(`http:${domain.id}`,domain.fullDomain,'unknown','Dominio registrado inválido.');continue;
      }
      const result = await this.probes.http(`https://${domain.fullDomain}/`);
      add(`http:${domain.id}`,`HTTP público: ${domain.fullDomain}`,result.ok ? 'pass' : [401,403].includes(result.status || 0) ? 'warn' : 'fail',result.status ? `HTTP ${result.status}${[401,403].includes(result.status) ? ' · acceso protegido; no prueba la salud interna' : ''}` : result.error || 'No responde.',result.ms);
    }
    if (data.domains.length) {
      const tunnel = all?.find(c => c.name === 'cloudflared');
      add('tunnel','Túnel Cloudflare',!all || !tunnel ? 'unknown' : tunnel.state === 'running' ? 'pass' : 'fail',tunnel ? `cloudflared: ${tunnel.state}. La comprobación HTTP pública verifica el recorrido externo.` : 'No se identificó el contenedor del túnel; puede estar fuera de Docker.');
    }
    const result = {id:crypto.randomUUID(),projectId:id,at:Date.now(),status:checks.some(c => c.state === 'fail') ? 'attention' : checks.some(c => ['unknown','warn'].includes(c.state)) ? 'partial' : 'ok',checks,warnings:data.warnings,operationalCommandsRun:0};
    this.hub.store.put('diagnostic',id,result);this.hub.store.append({actor,credentialId,action:'diagnostic.run',resource:id,projectId:id,status:'ok',detail:result.status});return result;
  }
}
