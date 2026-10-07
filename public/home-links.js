(() => {
  'use strict';
  const panel=document.createElement('section');panel.className='maint-panel';panel.id='home-links-panel';
  panel.innerHTML=`<h2>Tus accesos</h2><p>Abrí tus servicios y enlaces favoritos.</p><p id="home-links-status" role="status"></p><label>Buscar accesos<input id="home-links-filter" type="search" placeholder="Nombre, grupo o URL"></label><div id="home-links-list"></div><details><summary>Agregar desde Dominios y servicios</summary><p>Reutiliza los dominios configurados y su última observación. No genera consultas nuevas.</p><p id="home-sources-status" role="status"></p><div id="home-sources-list"></div></details><details><summary>Agregar o editar un acceso</summary><form id="home-links-form"><label>Nombre<input name="name" required maxlength="100"></label><label>URL<input name="url" required maxlength="2048" placeholder="https://…"></label><label>Grupo<input name="group" required value="Personal" maxlength="80"></label><button class="btn-primary" type="submit">Guardar acceso</button></form></details><details><summary>Importar accesos de Homepage</summary><p>Pegá services.yaml o bookmarks.yaml de Homepage. Se revisan sólo nombre, URL y grupo; widgets, credenciales y parámetros se omiten.</p><label>Configuración<textarea id="home-links-source" rows="5" maxlength="250000"></textarea></label><button id="home-links-preview" class="btn-secondary">Ver importación</button><div id="home-links-preview-content"></div></details><a href="/api/home/export" download>Exportar accesos JSON</a>`;
  const spot=document.querySelector('.home-quick');
  if(spot)spot.after(panel);
  else{const dash=document.querySelector('#tab-dashboard');if(!dash)return;dash.append(panel);}
  let state={links:[],revision:''},editing=null,preview=null,sources=[];
  const msg=(s,error=false)=>{const e=panel.querySelector('#home-links-status');e.textContent=s;e.classList.toggle('maint-error',error);};
  async function load(){
    const [links,known]=await Promise.allSettled([api('/api/home/links',{fresh:true}),api('/api/home/sources',{fresh:true})]);
    if(links.status==='fulfilled'){state={links:Array.isArray(links.value?.links)?links.value.links:[],revision:links.value?.revision||''};msg('');}else msg(links.reason.message,true);
    sources=known.status==='fulfilled'&&Array.isArray(known.value?.links)?known.value.links:[];
    panel.querySelector('#home-sources-status').textContent=known.status==='fulfilled'?(known.value?.coverage||''):'No se pudieron cargar los dominios. Tus accesos siguen disponibles.';
    render();
  }
  function statusLabel(link){
    let known=null;
    try{known=sources.find(s=>new URL(s.url,location.origin).origin===new URL(link.url,location.origin).origin);}catch{known=null;}
    if(!known)return 'Sin observación asociada';
    const label={up:'Dominio disponible',warn:'Dominio con advertencia',down:'Dominio sin respuesta',unknown:'Sin observación reciente'}[known.status];
    return label+(known.observedAt?' · '+new Date(known.observedAt).toLocaleTimeString():'');
  }
  function render(){const q=panel.querySelector('#home-links-filter').value.toLowerCase();const rows=state.links.filter(l=>`${l.name} ${l.url} ${l.group}`.toLowerCase().includes(q));panel.querySelector('#home-links-list').innerHTML=rows.map(l=>`<div class="maint-link-row"><a href="${esc(l.url)}" ${String(l.url||'').startsWith('/')?'':'target="_blank" rel="noopener noreferrer"'}><b>${l.favorite?'★ ':''}${esc(l.name)}</b><small>${esc(l.group)} · ${esc(l.url)}</small><small>${esc(statusLabel(l))}</small></a><button class="btn-secondary" data-id="${l.id}" data-action="favorite" aria-label="${l.favorite?'Quitar':'Marcar'} favorito: ${esc(l.name)}">${l.favorite?'★':'☆'}</button><button class="btn-secondary" data-id="${l.id}" data-action="up" aria-label="Subir ${esc(l.name)}">↑</button><button class="btn-secondary" data-id="${l.id}" data-action="edit">Editar</button><button class="btn-secondary" data-id="${l.id}" data-action="remove">Quitar</button></div>`).join('')||'<p>No hay accesos para esta búsqueda.</p>';
    panel.querySelector('#home-sources-list').innerHTML=sources.map(l=>`<div class="maint-link-row"><span><b>${esc(l.name)}</b><small>${esc(l.group)} · ${l.serviceType==='docker'?'Docker':'Proceso'} · ${esc(statusLabel(l))}</small></span><button class="btn-secondary" data-source="${l.id}" ${state.links.some(x=>x.id===l.id)?'disabled':''}>${state.links.some(x=>x.id===l.id)?'Agregado':'Agregar acceso'}</button></div>`).join('')||'<p>No hay dominios configurados para agregar.</p>';
  }
  async function save(links){const r=await api('/api/home/links',{method:'POST',body:{links,revision:state.revision}});state=Array.isArray(r?.links)?r:{links,revision:r?.revision||state.revision};render();msg('Accesos guardados.');}
  panel.querySelector('#home-links-filter').addEventListener('input',render);
  panel.querySelector('#home-links-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);try{const item={name:f.get('name'),url:f.get('url'),group:f.get('group'),favorite:state.links.find(x=>x.id===editing)?.favorite||false};const links=editing?state.links.map(x=>x.id===editing?item:x):[...state.links,item];await save(links);editing=null;e.target.reset();}catch(err){msg(err.message,true);}});
  panel.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
    if(b.dataset.source){const item=sources.find(l=>l.id===b.dataset.source);if(item&&!state.links.some(l=>l.id===item.id))await save([...state.links,item]);return;}
    if(b.dataset.id){const i=state.links.findIndex(l=>l.id===b.dataset.id);if(i<0)return;const links=structuredClone(state.links),item=links[i];
      if(b.dataset.action==='edit'){editing=item.id;const f=panel.querySelector('#home-links-form');f.closest('details').open=true;for(const k of ['name','url','group'])f.elements[k].value=item[k];f.elements.name.focus();return;}
      if(b.dataset.action==='favorite')item.favorite=!item.favorite;
      if(b.dataset.action==='up'&&i>0)[links[i-1],links[i]]=[links[i],links[i-1]];
      if(b.dataset.action==='remove'){const ok=typeof confirmDialog==='function'?await confirmDialog('Quitar acceso',`Se quita "${item.name}" de Tus accesos.`,'Quitar'):confirm(`¿Quitar "${item.name}"?`);if(!ok)return;links.splice(i,1);}await save(links);
    }
    if(b.id==='home-links-preview'){preview=await api('/api/home/import-preview',{method:'POST',body:{source:panel.querySelector('#home-links-source').value}});panel.querySelector('#home-links-source').value='';panel.querySelector('#home-links-preview-content').innerHTML=`<p>${preview.links.length} accesos válidos · ${preview.skipped} omitidos · ${preview.existing} ya existentes.</p><ul>${preview.links.map(l=>`<li>${esc(l.group)} · ${esc(l.name)} · ${esc(l.url)}</li>`).join('')}</ul><p>${preview.warnings.map(esc).join(' ')}</p><button id="home-links-import" class="btn-primary">Importar estos accesos</button>`;}
    if(b.id==='home-links-import'&&preview){state=await api('/api/home/import',{method:'POST',body:{links:preview.links,revision:state.revision}});render();msg('Accesos importados. Se conservaron tus favoritos y los accesos existentes.');preview=null;panel.querySelector('#home-links-preview-content').textContent='Importación guardada. Verificá cada acceso antes de retirar Homepage.';}
  }catch(err){msg(err.message,true);}});
  const dash=window.AxonPages?.dashboard;
  if(dash){const prev=dash.restore;dash.restore=async(...args)=>{await Promise.allSettled([prev?.(...args),load()]);};}
  else void load();
})();
