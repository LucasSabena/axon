(() => {
  'use strict';
  const stateNames={pass:'Correcto',fail:'Problema',warn:'Revisar',unknown:'Sin verificar',info:'Información',ok:'Correcto',failed:'Falló',running:'En curso',interrupted:'Interrumpido',partial:'Parcial',attention:'Requiere atención',verified:'Verificado',planned:'Preparado'};
  const badge=value=>`<span class="platform-state" data-state="${esc(value)}">${esc(stateNames[value]||value)}</span>`;
  const link=(url,label)=>`<a class="btn-secondary" href="${esc(url)}">${esc(label)}</a>`;
  const date=value=>value?new Date(value).toLocaleString('es-AR'):'Sin registro';
  const list=(items,render,empty='Sin elementos vinculados.')=>items?.length?`<ul class="platform-list">${items.map(v=>`<li>${render(v)}</li>`).join('')}</ul>`:`<div class="platform-empty">${esc(empty)}</div>`;
  const error=(node,err,retry)=>{
    node.querySelector('.platform-error')?.remove();const box=document.createElement('div');box.className='platform-error';box.setAttribute('role','alert');
    const text=document.createElement('span');text.textContent=err.message||'No se pudo actualizar.';const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.textContent='Reintentar';b.onclick=()=>AxonUI.busy(b,retry);box.append(text,b);node.prepend(box);
  };
  const busy=(node,label='Cargando…')=>{if(!node.children.length)node.innerHTML=`<div class="platform-loader" role="status">${esc(label)}</div>`;node.setAttribute('aria-busy','true');};
  const done=node=>node.removeAttribute('aria-busy');
  window.AxonPages ||= {};
  const hub=document.createElement('div');hub.id='project-hub';hub.className='platform-view';hub.hidden=true;document.querySelector('#tab-projects').append(hub);
  let projectId='',hubTicket=0,hubData;
  const summaryContainer=()=>[...document.querySelector('#tab-projects').children].filter(n=>n!==hub);
  const checks=diagnostic=>list(diagnostic?.checks,c=>`<div class="platform-check"><span>${esc(c.label)}<small>${esc(c.detail)}${c.ms!==undefined?' · '+c.ms+' ms':''}</small></span>${badge(c.state)}</div>`,'Todavía no se ejecutó un diagnóstico.');
  async function showHub(id) {
    projectId=id||'';const ticket=++hubTicket;
    hub.hidden=!projectId;summaryContainer().forEach(n=>n.hidden=!!projectId);
    if(!projectId){await loadProjects();return;}
    busy(hub,'Reuniendo recursos del proyecto…');
    try {
      const [data,report]=await Promise.all([api(`/api/project-hub/${encodeURIComponent(id)}`),api(`/api/project-hub/${encodeURIComponent(id)}/diagnostic`)]);
      if(ticket!==hubTicket)return;hubData=data;
      const consumption=data.consumption,summary=consumption?.summary;
      hub.innerHTML=`<div class="platform-toolbar">${link('/proyectos','Todos los proyectos')}<button class="btn-secondary" data-hub-refresh>Actualizar</button></div><div class="section-header"><div><h2>${esc(data.project.name)}</h2><p class="platform-path">${esc(data.project.cwd)}</p></div><button class="btn-primary" data-hub-diagnose>Diagnosticar aplicación</button></div>
        ${data.warnings.length?`<p role="status" class="platform-warning">${data.warnings.map(esc).join(' ')}</p>`:''}
        <div class="platform-toolbar">${link(data.links.files,'Archivos')}${link(data.links.terminal,'Terminal')}${link(data.links.chats,'Chats')}${link('/respaldos?project='+encodeURIComponent(id),'Respaldos')}${link('/historial?project='+encodeURIComponent(id),'Historial')}<button class="btn-secondary" data-hub-bind>Vincular recursos</button></div>
        <div class="platform-grid">
        <section class="platform-panel"><h3>Archivos del proyecto</h3>${list(data.files?.slice(0,12),f=>`<a href="/archivos?path=${encodeURIComponent(f.directory?data.project.cwd+'/'+f.name:data.project.cwd)}${f.directory?'':'&item='+encodeURIComponent(data.project.cwd+'/'+f.name)}">${esc(f.name)}</a><small>${f.directory?'Carpeta':f.symlink?'Enlace':'Archivo'}</small>`,'La carpeta está vacía o no se pudo consultar.')}</section>
        <section class="platform-panel"><h3>Terminales del proyecto</h3>${list(data.terminals,t=>`<a href="${esc(data.links.terminal)}&session=${encodeURIComponent(t.name)}">${esc(t.name)}</a><small>${esc(t.cwd)}</small>`,'Sin sesiones tmux detectadas en esta carpeta. Abrí Terminal para iniciar o retomar la sesión del proyecto.')}</section>
        <section class="platform-panel"><h3>Procesos y puertos</h3>${list(data.processes,p=>`${esc(p.name)} · PID ${p.pid}<small>${p.ports.map(v=>':'+v).join(', ')} · ${Math.round(p.memoryMb)} MB</small>`)}${!data.processes.length&&data.project.port?`<p>Puerto configurado :${data.project.port}; no demuestra que esté escuchando.</p>`:''}</section>
        <section class="platform-panel"><h3>Contenedores</h3>${list(data.containers,c=>`${esc(c.name)} ${badge(c.state)}<small>${esc(c.image)} · vínculo ${c.relation==='manual'?'manual':'por carpeta'}</small>`,'Sin contenedores vinculados. Usá Vincular recursos para asociar una base o servicio.')}</section>
        <section class="platform-panel"><h3>Dominios</h3>${list(data.domains,d=>`<a href="https://${esc(d.fullDomain)}" target="_blank" rel="noopener noreferrer">${esc(d.fullDomain)}</a><small>${esc(d.target)} · vínculo ${esc(d.relation)}</small>`)}</section>
        <section class="platform-panel"><h3>Consumo de IA · últimos 7 días</h3>${summary?`<div class="platform-metric">${Number(summary.total).toLocaleString('es-AR')} tokens</div><p>${summary.requests} solicitudes · ${summary.sessions} sesiones</p><p>Estimación con precios de API: USD ${Number(summary.usd).toFixed(4)}${summary.unpricedRequests?' · '+summary.unpricedRequests+' solicitudes sin precio':''}</p><small>${esc(consumption.coverage?.projectAttribution||'Sólo registros atribuibles a esta carpeta.')}</small>${consumption.coverage?.indexing?'<p class="platform-warning">Indexación en curso; el total puede ser parcial.</p>':''}`:'<p>No se pudo consultar el consumo.</p>'}</section>
        <section class="platform-panel"><h3>Chats</h3>${list(data.chats?.items,c=>`<a href="/agentes?id=__chats&entry=${encodeURIComponent(c.id)}&project=${encodeURIComponent(data.project.cwd)}">${esc(c.title)}</a><small>${esc(c.agent)} · ${date(c.updated)}</small>`,'Sin chats registrados para esta carpeta.')}<p>${data.chats?.total||0} conversaciones registradas.</p></section>
        <section class="platform-panel"><h3>Documentación</h3>${list(data.documents,d=>`<a href="/archivos?path=${encodeURIComponent(data.project.cwd)}&item=${encodeURIComponent(d.path)}&edit=1">${esc(d.name)}</a><small>${esc(d.excerpt.slice(0,180))}</small>`)}</section>
        </div><section class="platform-panel"><h3>Diagnóstico</h3><div data-hub-report>${checks(report.diagnostic)}</div></section><section class="platform-panel"><h3>Operaciones recientes</h3>${list(data.activity.slice(0,12),a=>`${badge(a.status)} ${esc(a.action)}<small>${esc(a.actor)} · ${date(a.at)}</small>`)}</section>`;
      hub.querySelector('[data-hub-refresh]').onclick=e=>AxonUI.busy(e.currentTarget,()=>showHub(id));
      hub.querySelector('[data-hub-diagnose]').onclick=e=>AxonUI.busy(e.currentTarget,async()=>{try{const result=await api(`/api/project-hub/${encodeURIComponent(id)}/diagnose`,{method:'POST',body:{}});hub.querySelector('[data-hub-report]').innerHTML=checks(result.diagnostic);toast('Diagnóstico actualizado','ok');}catch(err){error(hub,err,()=>showHub(id));}});
      hub.querySelector('[data-hub-bind]').onclick=()=>bindResources(id,data);
    } catch(err){if(ticket===hubTicket)error(hub,err,()=>showHub(id));}finally{if(ticket===hubTicket)done(hub);}
  }
  async function bindResources(id,data) {
    const panel=document.createElement('section');panel.className='platform-panel';panel.innerHTML='<h3>Vincular recursos del servidor</h3><p>Seleccioná los servicios que pertenecen a este proyecto. Los vínculos automáticos por carpeta se conservan.</p><div role="status">Cargando recursos…</div>';hub.prepend(panel);
    try{
      const inventory=await api('/api/project-hub-inventory');
      panel.innerHTML=`<h3>Vincular recursos</h3><form class="platform-form"><fieldset><legend>Contenedores</legend>${inventory.containers.map(c=>`<label><input type="checkbox" name="container" value="${esc(c.id)}" ${data.bindings.containers.includes(c.id)?'checked':''}>${esc(c.name)}</label>`).join('')}</fieldset><fieldset><legend>Dominios</legend>${inventory.domains.map(d=>`<label><input type="checkbox" name="domain" value="${esc(d.id)}" ${data.bindings.domains.includes(d.id)?'checked':''}>${esc(d.fullDomain)}</label>`).join('')}</fieldset><div class="platform-toolbar"><button type="submit" class="btn-primary">Guardar vínculos</button><button type="button" class="btn-secondary" data-cancel>Cancelar</button></div></form>`;
      panel.querySelector('[data-cancel]').onclick=()=>panel.remove();panel.querySelector('form').onsubmit=e=>{e.preventDefault();AxonUI.busy(panel.querySelector('[type=submit]'),async()=>{try{await api(`/api/project-hub/${encodeURIComponent(id)}/bindings`,{method:'PUT',body:{containers:[...panel.querySelectorAll('[name=container]:checked')].map(n=>n.value),domains:[...panel.querySelectorAll('[name=domain]:checked')].map(n=>n.value)}});await showHub(id);}catch(err){error(panel,err,()=>bindResources(id,data));}});};
    }catch(err){error(panel,err,()=>bindResources(id,data));}
  }
  window.AxonPages.projects={restore:params=>showHub(params.id),params:()=>projectId?{id:projectId}:{}};
  const originalProjectLoader=loaders.projects;loaders.projects=()=>projectId?showHub(projectId):originalProjectLoader();
  // Reuse existing tmux tabs; a stable session name groups the project's terminal.
  document.addEventListener('axon:route',async e=>{
    if(e.detail.section==='terminal'&&e.detail.params.project){try{const data=await api('/api/project-hub/'+encodeURIComponent(e.detail.params.project)+'/resources');const name=/^[a-zA-Z0-9_-]{1,32}$/.test(e.detail.params.session||'')?e.detail.params.session:'project-'+data.project.id.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,23);await openTermTab(name,data.project.cwd,{label:data.project.name});}catch(err){errToast(err);}}
  });
  const auditNode=document.getElementById('audit-content');let auditProject='',auditNext=null;
  async function loadAudit(params={},append=false){
    auditProject=params.project||auditProject||'';busy(auditNode);
    try{
      const query=new URLSearchParams();if(auditProject)query.set('project',auditProject);if(append&&auditNext)query.set('before',auditNext);
      const data=await api('/api/audit?'+query);auditNext=data.next;
      const rows=list(data.entries,a=>`${badge(a.status)} <strong>${esc(a.action)}</strong><small>${esc(a.actor)}${a.credentialId?' · token '+esc(a.credentialId.slice(0,8)):''} · ${date(a.at)}${a.httpStatus?' · HTTP '+a.httpStatus:''}</small><small>${esc(a.resource)}</small>${a.detail?`<small>${esc(a.detail)}</small>`:''}${a.recovery?link(a.recovery.url,a.recovery.label):''}`,'Todavía no hay operaciones registradas.');
      if(append){auditNode.querySelector('[data-audit-rows]').insertAdjacentHTML('beforeend',rows);}
      else{auditNode.innerHTML=`<p>Registro durable de acciones desde AXON. Los secretos y el contenido de las solicitudes no se guardan. El inicio de una acción y su resultado aparecen por separado.</p><div class="platform-toolbar"><button class="btn-secondary" data-audit-refresh>Actualizar</button>${auditProject?link('/historial','Todos los proyectos'):''}</div><section class="platform-panel" data-audit-rows>${rows}</section><button class="btn-secondary" data-audit-more>Cargar anteriores</button>`;auditNode.querySelector('[data-audit-refresh]').onclick=()=>loadAudit({project:auditProject});auditNode.querySelector('[data-audit-more]').onclick=e=>AxonUI.busy(e.currentTarget,()=>loadAudit({project:auditProject},true));}
      auditNode.querySelector('[data-audit-more]').hidden=data.entries.length<50;
    }catch(err){error(auditNode,err,()=>loadAudit(params));}finally{done(auditNode);}
  }
  window.AxonPages.audit={restore:params=>{auditProject=params.project||'';return loadAudit(params);},params:()=>auditProject?{project:auditProject}:{}};loaders.audit=()=>loadAudit({project:auditProject});
  const access=document.getElementById('access-content');
  const scopeNames={'projects:read':'Ver recursos','diagnostics:run':'Ejecutar diagnóstico','logs:read':'Leer logs','backups:read':'Ver respaldos','backups:run':'Ejecutar política de backup','audit:read':'Leer historial'};
  async function loadAccess(){busy(access);try{
    const data=await api('/api/access/tokens');
    access.innerHTML=`<p>Conectá scripts, CI y agentes mediante tokens limitados a proyectos y acciones. Un token no da acceso a la terminal ni a la cuenta administradora.</p><div class="platform-toolbar"><button class="btn-primary" data-token-new>Crear token</button><button class="btn-secondary" data-token-refresh>Actualizar</button></div><section class="platform-panel"><h3>Tokens</h3>${list(data.tokens,t=>`<div class="platform-check"><span><strong>${esc(t.name)}</strong> ${badge(t.revoked?'Revocado':t.expiresAt<Date.now()?'Vencido':'Activo')}<small>Vence ${date(t.expiresAt)} · último uso ${date(t.lastUsed)}</small><small>${t.grants.map(g=>`${esc(data.projects.find(p=>p.id===g.projectId)?.name||g.projectId)}: ${g.scopes.map(s=>esc(scopeNames[s])).join(', ')}`).join('<br>')}</small></span>${!t.revoked?`<button class="btn-danger" data-token-revoke="${esc(t.id)}">Revocar</button>`:''}</div>`,'No hay tokens. Creá uno para conectar una integración.')}</section><section class="platform-panel"><h3>Cómo conectar</h3><p>API: <code>/api/v1/projects</code> · MCP: <code>/api/v1/mcp</code></p><p>Enviá el token en <code>Authorization: Bearer …</code>. El endpoint MCP usa Streamable HTTP. Los permisos se comprueban en cada llamada.</p></section>`;
    access.querySelector('[data-token-new]').onclick=()=>newToken(data);access.querySelector('[data-token-refresh]').onclick=loadAccess;
    access.querySelectorAll('[data-token-revoke]').forEach(b=>b.onclick=async()=>{if(await confirmDialog('Revocar token','Las integraciones que usan este token perderán acceso inmediatamente.','Revocar'))await AxonUI.busy(b,async()=>{await api('/api/access/tokens/'+b.dataset.tokenRevoke,{method:'DELETE'});await loadAccess();});});
  }catch(err){error(access,err,loadAccess);}finally{done(access);}}
  function newToken(data){
    const panel=document.createElement('section');panel.className='platform-panel';panel.innerHTML=`<h3>Nuevo token</h3><form class="platform-form"><label>Nombre<input name="name" required maxlength="80" placeholder="CI de Demo"></label><label>Vigencia en días<input name="days" type="number" min="1" max="365" value="30" required></label><label>Proyecto<select name="project" required><option value="">Elegí un proyecto</option>${data.projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><fieldset><legend>Permisos</legend>${data.scopes.map(s=>`<label><input type="checkbox" name="scope" value="${esc(s)}" ${s==='projects:read'?'checked':''}>${esc(scopeNames[s])}</label>`).join('')}</fieldset><div class="platform-toolbar"><button type="submit" class="btn-primary">Crear token</button><button type="button" class="btn-secondary" data-cancel>Cancelar</button></div></form>`;access.prepend(panel);panel.querySelector('[data-cancel]').onclick=()=>panel.remove();panel.querySelector('[name=name]').focus();
    panel.querySelector('form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget;AxonUI.busy(form.querySelector('[type=submit]'),async()=>{try{const result=await api('/api/access/tokens',{method:'POST',body:{name:form.elements.namedItem('name').value,days:Number(form.elements.namedItem('days').value),grants:[{projectId:form.elements.namedItem('project').value,scopes:[...form.querySelectorAll('[name=scope]:checked')].map(n=>n.value)}]}});await loadAccess();const secret=document.createElement('section');secret.className='platform-panel';secret.innerHTML='<h3>Token creado</h3><p>Guardalo ahora. Se muestra una sola vez.</p><pre class="platform-secret"></pre><div class="platform-toolbar"><button class="btn-secondary" data-copy>Copiar token</button><button class="btn-secondary" data-close>Cerrar</button></div>';secret.querySelector('pre').textContent=result.token;secret.querySelector('[data-copy]').onclick=()=>navigator.clipboard.writeText(result.token).then(()=>toast('Token copiado','ok')).catch(err=>error(secret,err,()=>{}));secret.querySelector('[data-close]').onclick=()=>secret.remove();access.prepend(secret);}catch(err){error(panel,err,()=>{});}});};
  }
  window.AxonPages.access={restore:loadAccess};loaders.access=loadAccess;
})();
