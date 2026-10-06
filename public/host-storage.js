/* Shared live disks and host path picker. Loaded once, including lazy forms. */
(() => {
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=n=>n==null?'No disponible':new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(n/2**30)+' GB';
  let data=null,flight=null,error='',dialog=null,request=null,folder='',chosen=null,generation=0;
  const uniqueVolumes=volumes=>{
    const seen=new Set();return [...volumes].sort((a,b)=>Number(b.path==='/')-Number(a.path==='/')||Number(!!b.path)-Number(!!a.path)||Number(!!a.path?.startsWith('/mnt/axon-disks/'))-Number(!!b.path?.startsWith('/mnt/axon-disks/'))).filter(v=>{
      const k=(v.uuid||v.device)+':'+v.majorMinor;if(seen.has(k))return false;seen.add(k);return true;
    });
  };
  const state=v=>!v.path?'Sin montar':!v.readable?'Sin permiso':v.readOnly?'Sólo lectura':`${size(v.available)} libres`;
  function cards(){
    if(!data)return '<p>Buscando discos…</p>';
    const disks=uniqueVolumes(data.volumes);
    return disks.map(v=>`<button type="button" class="host-disk" data-host-volume="${esc(v.id)}" ${v.path&&!v.readable||!v.path&&!v.canMount?'disabled':''} title="${esc(v.path||v.device)}"><strong>${esc(v.name)}</strong><span>${size(v.size)} · ${esc(state(v))}${!v.path&&v.canMount?' · Montar':''}</span><small>${esc(v.path||v.device)}</small>${v.used!=null&&v.size?`<meter min="0" max="${v.size}" value="${v.used}" aria-label="Espacio ocupado"></meter>`:''}</button>`).join('')+data.devices.filter(d=>!disks.some(v=>v.diskId===d.id)).map(d=>`<span class="host-disk"><strong>${esc(d.name)}</strong><span>${size(d.size)} · Sin volumen navegable</span></span>`).join('')||'<p>No hay discos disponibles.</p>';
  }
  function render(){
    for(const el of document.querySelectorAll('[data-host-disks]')){
      const markup=`<div class="host-disks-heading"><strong>Discos del servidor</strong><button type="button" class="btn-secondary" data-host-refresh ${flight?'disabled':''}>Actualizar discos</button></div><div class="host-disks-grid">${cards()}</div><p class="host-disks-error" role="status">${esc(error)}</p>`;
      if(el.dataset.content!==markup){el.innerHTML=markup;el.dataset.content=markup;}
    }
  }
  async function refresh(){
    if(flight)return flight;
    flight=(async()=>{try{data=await api('/api/files/volumes',{fresh:true,signal:AbortSignal.timeout(35_000)});error='';window.dispatchEvent(new CustomEvent('axon:disks',{detail:data}));}catch(e){error='No se pudieron actualizar los discos. La lista puede estar desactualizada. Reintentá con Actualizar discos.';throw e;}finally{flight=null;render();}})();
    render();return flight;
  }
  async function openVolume(id){
    let v=data?.volumes.find(v=>v.id===id);if(!v)return;
    if(!v.path){const result=await api('/api/files/volumes/'+encodeURIComponent(id)+'/mount',{method:'POST',body:{}});await refresh();v=data.volumes.find(v=>v.path===result.path);}
    if(!v?.path)return;
    if(dialog?.open)await browse(v.path);else window.AxonNavigation.go('/archivos?path='+encodeURIComponent(v.path));
  }
  function ensureDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.id='host-path-picker';dialog.className='host-path-picker';dialog.setAttribute('aria-labelledby','host-picker-title');
    dialog.innerHTML=`<div class="host-picker-header"><h2 id="host-picker-title">Elegir carpeta</h2><button type="button" class="icon-btn" data-host-cancel aria-label="Cerrar selector">×</button></div><section data-host-disks aria-label="Discos disponibles"></section><form id="host-picker-location"><label for="host-picker-path">Ruta del servidor</label><div class="host-picker-location"><button type="button" class="btn-secondary" id="host-picker-up" aria-label="Carpeta superior">↑</button><input id="host-picker-path" autocomplete="off" spellcheck="false"><button class="btn-secondary" type="submit">Ir</button></div></form><p id="host-picker-status" role="status"></p><div id="host-picker-entries" class="host-picker-entries"></div><div class="host-picker-footer"><button type="button" class="btn-secondary" data-host-cancel>Cancelar</button><button type="button" class="btn-primary" id="host-picker-select">Elegir esta carpeta</button></div>`;
    document.body.append(dialog);
    dialog.addEventListener('close',()=>{generation++;const r=request;request=null;r?.resolve(chosen);chosen=null;});
    dialog.addEventListener('cancel',()=>{chosen=null;});
    dialog.querySelectorAll('[data-host-cancel]').forEach(b=>b.onclick=()=>dialog.close());
    dialog.querySelector('#host-picker-location').onsubmit=e=>{e.preventDefault();browse(dialog.querySelector('#host-picker-path').value);};
    dialog.querySelector('#host-picker-up').onclick=()=>browse(folder.replace(/\/+$/,'').split('/').slice(0,-1).join('/')||'/');
    dialog.querySelector('#host-picker-select').onclick=async()=>{
      if(!folder||request?.mode==='file')return;
      const b=dialog.querySelector('#host-picker-select');b.disabled=true;
      try{await api('/api/files?path='+encodeURIComponent(folder),{fresh:true});chosen=folder;dialog.close();}catch(e){pickerStatus(e.message);}finally{b.disabled=false;}
    };
    dialog.querySelector('#host-picker-entries').onclick=e=>{const b=e.target.closest('[data-host-entry]');if(!b)return;if(b.dataset.kind==='dir')browse(b.dataset.hostEntry);else{chosen=b.dataset.hostEntry;dialog.close();}};
  }
  function pickerStatus(s){dialog.querySelector('#host-picker-status').textContent=s;}
  async function browse(p){
    const ticket=++generation;folder='';dialog.querySelector('#host-picker-select').disabled=true;dialog.querySelector('#host-picker-entries').innerHTML='';pickerStatus('Cargando carpeta…');
    try{
      const result=await api('/api/files?path='+encodeURIComponent(p||'~'),{fresh:true,signal:AbortSignal.timeout(35_000)});
      if(ticket!==generation||!dialog.open)return;
      folder=result.path;dialog.querySelector('#host-picker-path').value=folder;
      const entries=result.entries.filter(e=>e.type==='dir'||request?.mode==='file'&&e.type==='file'&&(!request.extensions||request.extensions.some(ext=>e.name.toLowerCase().endsWith(ext))));
      dialog.querySelector('#host-picker-entries').innerHTML=entries.map(e=>`<button type="button" data-host-entry="${esc(folder.replace(/\/$/,'')+'/'+e.name)}" data-kind="${esc(e.type)}"><span aria-hidden="true">${e.type==='dir'?'▸':'·'}</span>${esc(e.name)}</button>`).join('');
      const blocked=request?.writable&&result.volume?.readOnly;
      dialog.querySelector('#host-picker-select').disabled=request?.mode==='file'||!!blocked;
      pickerStatus(blocked?'Este disco es de sólo lectura. Elegí un destino que permita escribir.':entries.length?'':request?.mode==='file'?'No hay archivos compatibles en esta carpeta.':'Esta carpeta está vacía.');
    }catch(e){if(ticket===generation)pickerStatus(e.message);}
  }
  async function pick(options={}){
    ensureDialog();if(dialog.open)return null;
    const promise=new Promise(resolve=>{request={...options,resolve};});chosen=null;folder='';
    dialog.querySelector('#host-picker-title').textContent=options.title||'Elegir carpeta';dialog.querySelector('#host-picker-select').hidden=options.mode==='file';dialog.showModal();
    render();refresh().catch(()=>{});browse(options.start||'~');return promise;
  }
  const fields={
    'project-edit-cwd':{title:'Carpeta del proyecto'},'settings-scan-dirs':{title:'Buscar proyectos en esta carpeta',append:true},
    'lst-roots':{title:'Agregar carpeta a Biblioteca',append:true},'lst-up':{title:'Carpeta de subidas',writable:true},
    'backup-repository':{title:'Disco para guardar respaldos',suffix:'/AXON-Respaldos',writable:true},'agf-agent-dir':{title:'Carpeta de configuración del agente'},'drop-saveto':{title:'Guardar en esta carpeta',writable:true},
    'drop-serve-path':{title:'Elegir archivo para compartir',mode:'file'}
  };
  const bound=new WeakSet();
  function bind(){
    for(const [id,opts] of Object.entries(fields)){
      const input=document.getElementById(id);if(!input||bound.has(input))continue;bound.add(input);
      const button=document.createElement('button');button.type='button';button.className='btn-secondary host-picker-trigger';button.textContent=opts.append?'Agregar carpeta de un disco':'Explorar discos';button.setAttribute('aria-label',opts.title);
      button.onclick=async()=>{const selected=await pick({...opts,start:opts.append?'~':input.value||'~'});if(!selected)return;const value=opts.suffix?selected.replace(/\/$/,'')+opts.suffix:selected;input.value=opts.append?[...new Set([...input.value.split('\n').map(s=>s.trim()).filter(Boolean),selected])].join('\n'):value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};input.insertAdjacentElement('afterend',button);
    }
    for(const id of ['dashboard','ops','metrics','storage','agents','projects','library','compose','drop','backups']){
      const sec=document.getElementById('tab-'+id);if(!sec||sec.querySelector('.host-disks-panel'))continue;
      const panel=document.createElement('section');panel.className='host-disks-panel';panel.dataset.hostDisks='';panel.setAttribute('aria-label','Discos del servidor');const head=sec.querySelector('.section-header');if(head)head.insertAdjacentElement('afterend',panel);else sec.prepend(panel);
    }
    render();
  }
  document.addEventListener('click',async e=>{
    const volume=e.target.closest('[data-host-volume]'),retry=e.target.closest('[data-host-refresh]');if(!volume&&!retry)return;
    const b=volume||retry;b.disabled=true;
    try{if(volume)await openVolume(volume.dataset.hostVolume);else await refresh();}catch(err){if(dialog?.open)pickerStatus(err.message);else if(typeof errToast==='function')errToast(err);}finally{b.disabled=false;}
  });
  document.getElementById('host-disks-open')?.addEventListener('click',async()=>{const p=await pick({title:'Explorar discos del servidor'});if(p)window.AxonNavigation.go('/archivos?path='+encodeURIComponent(p));});
  let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;bind();});}).observe(document.body,{childList:true,subtree:true});
  window.AxonStorage={pick,refresh,uniqueVolumes,get snapshot(){return data;}};
  window.addEventListener('axon:navigate',()=>{bind();refresh().catch(()=>{});});
  window.addEventListener('focus',()=>refresh().catch(()=>{}));
  setInterval(()=>{if(!document.hidden)refresh().catch(()=>{});},12_000);
  bind();refresh().catch(()=>{});
})();
