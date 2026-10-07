/* Local chat and memory reader. Text is escaped; logs never become executable HTML. */
(() => {
  'use strict';
  const names={codex:'Codex',claude:'Claude Code',opencode:'OpenCode / OpenChamber',gemini:'Gemini',engram:'Engram · compartida',windsurf:'Windsurf'};
  let state={},kind=null,root=null,epoch=0,timer=null,item=null,messages=[],dirty=false,searchFocus=null,indexTimer=null;
  const url=(params={})=>window.AxonNavigation.url('agents',{id:kind==='chats'?'__chats':'__memories',...state,...params});
  const date=n=>n?new Date(n).toLocaleString('es-AR'):'Sin fecha';
  const go=params=>window.AxonNavigation.go(url(params));
  const current=token=>token===epoch && root?.isConnected && window.AxonNavigation.current.section==='agents' && window.AxonNavigation.current.params.id===(kind==='chats'?'__chats':'__memories');
  const fileUrl=p=>{const slash=p.lastIndexOf('/');return window.AxonNavigation.url('files',{path:p.slice(0,slash)||'/',item:p.slice(slash+1),hidden:'1'});};
  const pathLink=p=>`<a href="${esc(fileUrl(p))}" title="Ver en Archivos">${esc(p)}</a>`;
  async function copy(text){try{await navigator.clipboard.writeText(text);toast('Contexto copiado','ok');}catch{toast('No se pudo copiar. Usá Descargar Markdown.');}}
  const fileName=t=>(String(t||'memoria').toLowerCase().replace(/[^\wáéíóúñü-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60)||'memoria')+'.md';
  function download(text,name){const u=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);}
  function markdown(){return `# ${item.title}\n\nProyecto: ${item.project}\nOrigen: ${item.source}\n\n${item.content||messages.map(m=>`## ${m.role}\n\n${m.text}`).join('\n\n')}`;}
  function filesPanel(files){return `<details class="ctx-files"><summary>Archivos referenciados${kind==='chats'?' en los mensajes cargados':''} (${files.length})</summary><p class="listener-note">Referencias extraídas del historial; no implican que el archivo exista o haya cambiado.</p><ul>${files.map(p=>`<li>${p.startsWith('/')?pathLink(p):`<code>${esc(p)}</code>`}</li>`).join('')}</ul></details>`;}
  function showError(e,token){if(current(token)){root.querySelector('#ctx-body').innerHTML=`<p role="alert" class="ctx-error">${esc(e.message)}</p><button class="btn-secondary" id="ctx-retry">Reintentar</button>`;root.querySelector('#ctx-retry').onclick=()=>render(root,kind,state);}}
  function tools(data){
    const agents=Object.entries(names).filter(([key])=>kind==='chats'?!['engram','windsurf'].includes(key):!['opencode','gemini'].includes(key));
    const projectOptions=data.projects.map(p=>`<option value="${esc(p.project)}" ${state.project===p.project?'selected':''}>${esc(p.project.replace(/^\/home\/[^/]+\/Proyectos\//,''))} (${p.count})</option>`).join('');
    root.querySelector('#ctx-filters').innerHTML=`<label>Buscar<input id="ctx-q" type="search" class="filter-input" placeholder="Texto, archivo o título…" value="${esc(state.q||'')}"></label><label>Proyecto<select id="ctx-project" class="filter-input"><option value="">Todos los proyectos</option>${projectOptions}</select></label><label>Origen<select id="ctx-agent" class="filter-input"><option value="">Todos los orígenes</option>${agents.map(([a,n])=>`<option value="${a}" ${state.agent===a?'selected':''}>${n}</option>`).join('')}</select></label>${kind==='memories'?`<label>Tipo<select id="ctx-type" class="filter-input"><option value="">Todos los tipos</option>${data.types.map(t=>`<option value="${esc(t)}" ${state.type===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`:''}`;
    root.querySelector('#ctx-q').oninput=e=>{clearTimeout(timer);const q=e.target.value;timer=setTimeout(()=>go({q,entry:null,offset:null}),450);};
    for(const key of ['project','agent','type'])root.querySelector('#ctx-'+key)?.addEventListener('change',e=>go({[key]:e.target.value,entry:null,offset:null}));
    if(searchFocus){const input=root.querySelector('#ctx-q');input.focus();input.setSelectionRange(searchFocus.start,searchFocus.end);searchFocus=null;}
  }
  function continueIndex(token){
    clearTimeout(indexTimer);indexTimer=setTimeout(async()=>{
      if(!current(token)||state.entry||document.hidden)return;
      try{const data=await api('/api/agent-context/chats/indexing');if(!current(token))return;
        const status=root.querySelector('#ctx-status');status.textContent=status.textContent.replace(/ · \d+ chats pendientes de indexar para búsqueda por contenido/,'')+(data.pending?` · ${data.pending} chats pendientes de indexar para búsqueda por contenido`:'');
        if(data.pending)continueIndex(token);else{root.querySelector('#ctx-index')?.remove();if(state.q)await list(token);}
      }catch(err){if(current(token))root.querySelector('#ctx-warnings').textContent='Se pausó la indexación. Usá Continuar indexando para reintentar.';}
    },2500);
  }
  async function list(token){
    const params=new URLSearchParams(Object.entries(state).filter(([k,v])=>['q','project','agent','type','offset'].includes(k)&&v));
    const data=await api(`/api/agent-context/${kind}?${params}`);if(!current(token))return;
    tools(data);root.querySelector('#ctx-status').textContent=`${data.total} ${kind==='chats'?'conversaciones':'memorias'}${data.pending?` · ${data.pending} chats pendientes de indexar para búsqueda por contenido`:''}`;
    root.querySelector('#ctx-warnings').textContent=data.warnings.join(' ');
    const groups=new Map();for(const row of data.items){if(!groups.has(row.project))groups.set(row.project,[]);groups.get(row.project).push(row);}
    root.querySelector('#ctx-body').innerHTML=data.items.length?[...groups].map(([project,rows])=>`<section class="ctx-group"><h4 title="${esc(project)}">${esc(project.split('/').pop())}<small>${esc(project)}</small></h4><div class="ctx-list">${rows.map(r=>`<a class="ctx-row" href="${esc(url({entry:r.id,offset:null}))}"><span><strong>${esc(r.title)}</strong><small>${esc(names[r.agent]||r.agent)}${r.type?' · '+esc(r.type):''} · ${esc(date(r.updated))}</small><code>${esc(r.source)}</code></span>${icon('chevron-right')}</a>`).join('')}</div></section>`).join(''):'<p class="empty-state">No hay resultados con estos filtros.</p>';
    // `from` records where Siguiente left off — Anterior goes back exactly
    // instead of assuming a fixed page size server-side.
    root.querySelector('#ctx-pagination').innerHTML=`${Number(state.offset)>0?`<a class="btn-secondary" href="${esc(url({offset:state.from?Number(state.from):Math.max(0,Number(state.offset)-40),from:null}))}">Anterior</a>`:''}${data.next!==null?`<a class="btn-secondary" href="${esc(url({offset:data.next,from:Number(state.offset)||0}))}">Siguiente</a>`:''}${data.pending?'<button class="btn-secondary" id="ctx-index">Continuar indexando</button>':''}`;
    root.querySelector('#ctx-index')?.addEventListener('click',()=>render(root,kind,state));refreshIcons();if(kind==='chats'&&data.pending)continueIndex(token);
  }
  function messageHtml(m){return `<article class="ctx-message"><label class="ctx-select"><input type="checkbox" data-message-select="${m.id}" aria-label="Seleccionar mensaje ${m.id}"> ${esc(m.role)} <small>${esc(date(m.at?Number.isFinite(Number(m.at))?Number(m.at):Date.parse(m.at):0))}</small></label>${m.kind==='tool'?`<details><summary>Comando o resultado de herramienta</summary><pre>${esc(m.text)}</pre></details>`:`<pre>${esc(m.text)}</pre>`}</article>`;}
  async function detail(token){
    const data=await api(`/api/agent-context/${kind}/${state.entry}`);if(!current(token))return;item=data.item;messages=data.messages||[];
    root.querySelector('#ctx-filters').innerHTML=`<a class="btn-secondary" href="${esc(url({entry:null}))}">${icon('arrow-left')} Volver a ${kind==='chats'?'chats':'memorias'}</a><button class="btn-secondary" id="ctx-copy">Copiar ${kind==='chats'?'mensajes cargados':'memoria'}</button>${kind==='chats'?`<button class="btn-secondary" id="ctx-copy-full">Copiar chat completo</button><a class="btn-secondary" href="/api/agent-context/chats/${esc(state.entry)}/export" download>Descargar chat completo</a><button class="btn-secondary" id="ctx-selection">Copiar selección</button>`:'<button class="btn-secondary" id="ctx-export">Descargar Markdown</button><button class="btn-primary" id="ctx-edit">Editar memoria</button>'}`;
    root.querySelector('#ctx-status').textContent=`${names[item.agent] || item.agent || 'Origen desconocido'} · ${item.project}`;
    root.querySelector('#ctx-body').innerHTML=`<h4 class="ctx-title">${esc(item.title)}</h4><div class="ctx-origin"><span>Origen</span><code>${esc(item.source)}</code><button class="btn-secondary" id="ctx-path">Copiar ruta</button><a href="${esc(fileUrl(item.source))}">Ver archivo</a></div>${item.topic?`<p class="listener-note">Tema: ${esc(item.topic)} · Ámbito: ${esc(item.scope)}</p>`:''}${filesPanel(data.files||[])}${kind==='memories'?`<pre class="ctx-memory">${item.content?esc(item.content):'Esta memoria todavía no tiene contenido.'}</pre><div id="ctx-editor" hidden></div>`:`<div id="ctx-messages">${messages.length?messages.map(messageHtml).join(''):'<p class="empty-state">Esta conversación todavía no tiene mensajes para mostrar.</p>'}</div>`}`;
    root.querySelector('#ctx-copy').onclick=()=>copy(markdown());root.querySelector('#ctx-path').onclick=()=>copy(item.source);
    if(kind==='memories'){
      root.querySelector('#ctx-export').onclick=()=>download(markdown(),fileName(item.title));root.querySelector('#ctx-edit').onclick=()=>edit(token);
    }else{
      root.querySelector('#ctx-copy-full').onclick=async e=>{const button=e.currentTarget;button.disabled=true;try{const response=await fetch(`/api/agent-context/chats/${state.entry}/export`,{credentials:'same-origin'});if(!response.ok)throw new Error('No se pudo leer el chat completo');await copy(await response.text());}catch(err){errToast(err);}finally{button.disabled=false;}};
      root.querySelector('#ctx-selection').onclick=()=>{const chosen=[...root.querySelectorAll('[data-message-select]:checked')].map(c=>messages.find(m=>m.id===c.dataset.messageSelect));if(!chosen.length)return toast('Seleccioná uno o más mensajes.');copy(`# ${item.title}\nProyecto: ${item.project}\nOrigen: ${item.source}\n\n`+chosen.map(m=>`## ${m.role}\n\n${m.text}`).join('\n\n'));};
      let next=data.next;const fileSet=new Set(data.files||[]);
      root.querySelector('#ctx-pagination').innerHTML=next!==null?'<p class="listener-note">Se muestran los primeros mensajes. La descarga incluye el chat completo.</p><button class="btn-secondary" id="ctx-more">Cargar más mensajes</button>':'';
      root.querySelector('#ctx-more')?.addEventListener('click',async e=>{
        const button=e.currentTarget;button.disabled=true;
        try{const d=await api(`/api/agent-context/chats/${state.entry}?offset=${next}`);if(!current(token))return;messages.push(...d.messages);for(const file of d.files||[])fileSet.add(file);root.querySelector('.ctx-files').outerHTML=filesPanel([...fileSet].sort());root.querySelector('#ctx-messages').insertAdjacentHTML('beforeend',d.messages.map(messageHtml).join(''));next=d.next;if(next===null)root.querySelector('#ctx-pagination').replaceChildren();}catch(err){errToast(err);}finally{button.disabled=false;}
      });
    }
    refreshIcons();
  }
  function edit(token){
    const box=root.querySelector('#ctx-editor');box.hidden=false;root.querySelector('.ctx-memory').hidden=true;
    box.innerHTML=`${item.agent==='engram'?`<label>Título<input id="ctx-title-edit" class="filter-input" value="${esc(item.title)}" maxlength="500"></label>`:''}<label>Contenido<textarea id="ctx-content-edit" class="filter-input" spellcheck="false">${esc(item.content)}</textarea></label><p class="listener-note">Se guarda en el origen y se conserva un respaldo. Si otro agente cambió la memoria, se solicita recargarla.</p><div class="ctx-actions"><button class="btn-primary" id="ctx-save">Guardar cambios</button><button class="btn-secondary" id="ctx-cancel">Cancelar</button></div><p id="ctx-save-status" role="status"></p>`;
    const input=box.querySelector('#ctx-content-edit'),title=box.querySelector('#ctx-title-edit');
    const mark=()=>{dirty=input.value!==item.content || !!title&&title.value!==item.title;};input.oninput=mark;if(title)title.oninput=mark;
    box.querySelector('#ctx-cancel').onclick=async()=>{if(dirty&&!await confirmDialog('Descartar edición','Los cambios sin guardar se descartan.','Descartar'))return;dirty=false;box.hidden=true;root.querySelector('.ctx-memory').hidden=false;};
    box.querySelector('#ctx-save').onclick=async e=>{
      const button=e.currentTarget;button.disabled=true;box.querySelector('#ctx-save-status').textContent='Guardando…';
      try{const d=await api(`/api/agent-context/memories/${state.entry}`,{method:'POST',body:{content:input.value,title:title?.value||item.title,revision:item.revision}});if(!current(token))return;item=d.item;dirty=false;await detail(token);toast('Memoria guardada con respaldo','ok',d.backup?'Respaldo: '+d.backup:'');}
      catch(err){
        const st=box.querySelector('#ctx-save-status');
        if(err.status===409){
          // the memory changed underneath — offer a way out, keeping the
          // editor text so the user can copy it before reloading
          st.innerHTML=`${esc(err.message)} <button class="btn-secondary" id="ctx-reload">Descartar y recargar</button>`;
          st.querySelector('#ctx-reload').onclick=async()=>{dirty=false;await detail(token);};
        } else st.textContent=err.message;
      }
      finally{button.disabled=false;}
    };input.focus();
  }
  async function render(element,mode,params={}){
    const active=document.activeElement;searchFocus=active?.id==='ctx-q'?{start:active.selectionStart,end:active.selectionEnd}:null;
    clearTimeout(timer);clearTimeout(indexTimer);epoch++;const token=epoch;root=element;kind=mode;state={};item=null;messages=[];dirty=false;
    for(const k of ['q','project','agent','type','entry','offset','from'])if(params[k])state[k]=params[k];
    root.innerHTML=`<div class="ctx-heading"><h3>${kind==='chats'?'Chats por proyecto':'Memorias locales'}</h3><p class="listener-note">${kind==='chats'?'Conversaciones de solo lectura. Compartí el contexto o descargá el historial en Markdown.':'Engram y archivos de memoria locales. Buscá, revisá y editá en su origen.'}</p></div><div id="ctx-filters" class="ctx-filters"></div><p id="ctx-status" class="listener-note" role="status" aria-live="polite">Cargando…</p><p id="ctx-warnings" class="ctx-error" role="status"></p><div id="ctx-body">${AxonUI.skeleton('Leyendo contexto local…')}</div><div id="ctx-pagination" class="ctx-actions"></div>`;
    try{if(state.entry)await detail(token);else await list(token);}catch(e){showError(e,token);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&kind==='chats'&&!state.entry&&root?.querySelector('#ctx-index'))continueIndex(epoch);});
  window.AgentContext={render,params:()=>['__chats','__memories'].includes(window.AxonNavigation?.current?.params.id)?state:{},dirty:()=>dirty,canLeave:async()=>{if(!dirty)return true;const yes=await confirmDialog('Descartar edición','Tenés cambios de memoria sin guardar.','Descartar');if(yes)dirty=false;return yes;}};
})();
