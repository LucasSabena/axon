/* Disk administration lives in Storage. Shared lists keep presentation-only
   visibility metadata; this module never receives a shell or arbitrary path. */
(() => {
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:1}).format(n/2**30)+' GiB';
  const date=n=>new Date(n*1000).toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'});
  const labels={layout:'Preparar disco y crear particiones',append:'Agregar particiones sin borrar las existentes',format:'Formatear esta partición',delete:'Eliminar esta partición',mount:'Montar partición',unmount:'Desmontar partición',configure:'Configurar montaje automático'};
  const states={planned:'Revisión pendiente',running:'En curso',verified:'Verificado',failed:'Falló · revisar resultado',interrupted:'Interrumpido · revisar resultado'};
  let root=null,data=null,showHidden=false,busy=false,ticket=0,dialog=null,wizard=null,returnFocus=null,operation=null,poll=null;
  const status=(text,error=false)=>{const el=root?.querySelector('[data-disks-status]');if(el){el.textContent=text;el.classList.toggle('maint-error',error);}};
  const partProtected=(d,p)=>p.technical||d.blockers.length>0;
  function render(){
    if(!root)return;
    const disks=data?.disks.filter(d=>showHidden||!d.hidden)||[];
    const hiddenCount=data?(data.volumes.devices.filter(d=>d.hidden).length+data.volumes.volumes.filter(v=>v.hidden).length):0;
    root.innerHTML=`<div class="disk-heading"><div><h3>Discos y particiones</h3><p>Prepará un disco para tus archivos y elegí qué aparece en AXON.</p></div><button type="button" class="btn-secondary" data-disk-refresh ${busy?'disabled':''}>Actualizar</button></div>
      <div class="disk-toolbar"><label><input type="checkbox" data-show-hidden ${showHidden?'checked':''}> Mostrar ocultos${hiddenCount?' ('+hiddenCount+')':''}</label><span>Ocultar sólo cambia las listas de AXON. El disco sigue funcionando.</span></div>
      <p data-disks-status role="status" aria-live="polite"></p>${data?.fixture?'<p class="disk-note">Entorno de prueba: las operaciones se simulan y no modifican discos reales.</p>':''}
      <div class="disk-list">${disks.map(d=>{
        const parts=d.partitions.filter(p=>showHidden||!p.hidden);
        const used=d.partitions.reduce((sum,p)=>sum+p.size,0),free=Math.max(0,d.size-used),appendable=d.appendableBytes??free;
        return `<article class="disk-device ${d.hidden?'disk-is-hidden':''}"><header><div><strong>${esc(d.name)}</strong><p>${size(d.size)} · ${d.external?'Externo / extraíble':'Interno'} · ${esc(d.table?.toUpperCase()||'Sin tabla de particiones')}</p><small>${esc(d.device)} · Serie: ${esc(d.serial||d.wwn||'No disponible')}</small></div><div class="disk-actions">${d.visibilityKey?`<button type="button" class="btn-secondary" data-visibility="${esc(d.visibilityKey)}" data-hidden="${!d.hidden}">${d.hidden?'Mostrar disco':'Ocultar disco'}</button>`:''}<button type="button" class="btn-primary" data-disk-operation="layout" data-disk="${esc(d.id)}" ${!d.canEdit||!data.canPartition?'disabled':''}>Preparar disco</button></div></header>
          <div class="disk-map" aria-label="Distribución de particiones de ${esc(d.name)}">${d.partitions.map((p,i)=>`<span class="disk-map-part disk-color-${i%4}${p.hidden?' disk-muted':''}" style="flex-grow:${Math.max(1,p.size)}" title="${p.hidden&&!showHidden?'Partición oculta':esc(p.name)} · ${size(p.size)}"><span>${p.hidden&&!showHidden?'Oculta':esc(p.name)}</span></span>`).join('')}${free>2**20?`<span class="disk-map-free" style="flex-grow:${free}" title="Sin particionar · ${size(free)}"><span>Libre</span></span>`:''}</div>
          ${d.editReason?`<p class="disk-note">${esc(d.editReason)}</p>`:''}
          <div class="disk-partitions">${parts.map(p=>`<div class="disk-partition ${p.hidden?'disk-is-hidden':''}"><div><strong>${esc(p.name)}</strong>${p.technical?'<span class="disk-tag">Arranque / sistema</span>':''}${p.hidden?'<span class="disk-tag">Oculta</span>':''}<p>${size(p.size)} · ${esc(p.filesystem||'Sin formato')} · ${p.mounts.length?'Montada':'Sin montar'}${p.autoMount?' · Automática al reiniciar':''}</p><small>${esc(p.mounts[0]?.path||p.device)}</small></div><div class="disk-actions">${p.visibilityKey?`<button type="button" class="btn-secondary" data-visibility="${esc(p.visibilityKey)}" data-hidden="${!p.hidden}">${p.hidden?'Mostrar':'Ocultar'}</button>`:''}${p.filesystem&&['ext4','exfat'].includes(p.filesystem)?`<button type="button" class="btn-secondary" data-disk-operation="${p.mounts.length?'unmount':'mount'}" data-disk="${esc(d.id)}" data-partition="${esc(p.id)}" ${partProtected(d,p)?'disabled':''}>${p.mounts.length?'Desmontar':'Montar'}</button><button type="button" class="btn-secondary" data-disk-operation="configure" data-disk="${esc(d.id)}" data-partition="${esc(p.id)}" ${partProtected(d,p)?'disabled':''}>Montaje automático</button>`:''}<button type="button" class="btn-secondary" data-disk-operation="format" data-disk="${esc(d.id)}" data-partition="${esc(p.id)}" ${!d.canEdit?'disabled':''}>Formatear</button>${p.number?`<button type="button" class="btn-secondary" data-disk-operation="delete" data-disk="${esc(d.id)}" data-partition="${esc(p.id)}" ${!d.canEdit?'disabled':''}>Eliminar partición</button>`:''}</div></div>`).join('')||`<p class="disk-empty">${d.partitions.length?'Las particiones están ocultas. Activá “Mostrar ocultos” para administrarlas.':'El disco no tiene particiones ni un formato utilizable.'}</p>`}</div>
          ${d.table==='gpt'?`<footer><span>Espacio disponible al final del disco: hasta ${size(appendable)}.</span><button type="button" class="btn-secondary" data-disk-operation="append" data-disk="${esc(d.id)}" ${!d.canEdit||appendable<64*2**20||!data.canPartition?'disabled':''}>Agregar partición</button></footer>`:''}</article>`;
      }).join('')||'<p class="disk-empty">No hay discos visibles. Activá “Mostrar ocultos” o actualizá la lista.</p>'}</div>
      <details class="disk-other"><summary>Visibilidad de todos los volúmenes</summary><p>También podés mostrar u ocultar volúmenes del sistema y sus alias. No cambia permisos, montajes ni respaldos existentes.</p>${(data?.volumes.volumes||[]).map(v=>`<div class="disk-partition"><div><strong>${esc(v.name)}</strong><small>${esc(v.path||v.device)}${v.technical?' · Arranque / sistema':''}</small></div><button type="button" class="btn-secondary" data-visibility="${esc(v.visibilityKey)}" data-hidden="${!v.hidden}">${v.hidden?'Mostrar':'Ocultar'}</button></div>`).join('')}</details>
      <section class="disk-history" aria-label="Operaciones de discos"><h3>Últimas operaciones</h3><div data-disk-history>Cargando historial…</div></section>`;
    root.querySelector('[data-show-hidden]').onchange=e=>{showHidden=e.target.checked;render();history();};
  }
  async function history(){
    if(!root)return;
    try{const r=await api('/api/storage/disks/history',{fresh:true});const node=root?.querySelector('[data-disk-history]');if(!node)return;
      node.innerHTML=r.operations.map(o=>`<article><strong>${esc(labels[o.spec.operation]||o.spec.operation)} · ${esc(o.diskName)}</strong><p>${esc(states[o.state]||o.state)} · ${date(o.createdAt)}</p><p>${esc(o.message)}</p><button type="button" class="btn-secondary" data-disk-result="${esc(o.id)}">Ver resultado</button></article>`).join('')||'<p>Todavía no hiciste cambios en discos desde AXON.</p>';
    }catch(e){const node=root?.querySelector('[data-disk-history]');if(node)node.textContent=e.message;}
  }
  async function refresh(){
    if(busy)return;busy=true;const current=++ticket;
    status('Buscando discos y particiones…');
    try{const result=await api('/api/storage/disks',{fresh:true,signal:AbortSignal.timeout(50_000)});if(current!==ticket||!root)return;data=result;render();await history();status('Discos actualizados.');}
    catch(e){status(e.message,true);}finally{busy=false;root?.querySelector('[data-disk-refresh]')?.removeAttribute('disabled');}
  }
  function ensureDialog(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.className='disk-dialog';dialog.setAttribute('aria-labelledby','disk-dialog-title');
    dialog.innerHTML='<header class="disk-dialog-head"><h2 id="disk-dialog-title"></h2><button type="button" class="btn-secondary" data-disk-close aria-label="Cerrar configuración de disco">Cerrar</button></header><div data-disk-dialog-content></div><p data-disk-dialog-status role="status" aria-live="polite"></p>';
    document.body.append(dialog);
    dialog.addEventListener('close',()=>{wizard=null;clearTimeout(poll);operation=null;returnFocus?.focus();});
    dialog.querySelector('[data-disk-close]').onclick=()=>dialog.close();
  }
  const dialogStatus=(message,error=false)=>{const el=dialog.querySelector('[data-disk-dialog-status]');el.textContent=message;el.classList.toggle('maint-error',error);};
  const dialogContent=()=>dialog.querySelector('[data-disk-dialog-content]');
  function startWizard(d,kind,part,button){
    ensureDialog();returnFocus=button;
    wizard={disk:d,kind,part,rows:[{name:part?.name&&/^[A-Za-z0-9][A-Za-z0-9 _-]{0,14}$/.test(part.name)?part.name:'DATOS',filesystem:'ext4',sizeMiB:null}],autoMount:kind==='configure'?!!part.autoMount:data.canAutoMount!==false&&['layout','append','format','mount'].includes(kind),plan:null,busy:false};
    dialog.querySelector('#disk-dialog-title').textContent=labels[kind];dialogStatus('');drawEditor();dialog.showModal();
  }
  function collect(){
    const w=wizard;if(!w)return;
    dialogContent().querySelectorAll('[data-part-row]').forEach((row,i)=>{w.rows[i]={name:row.querySelector('[name=name]').value,filesystem:row.querySelector('[name=filesystem]').value,sizeMiB:row.querySelector('[name=remaining]').checked?null:Math.round(Number(row.querySelector('[name=size]').value)*1024)};});
    w.autoMount=dialogContent().querySelector('[name=autoMount]')?.checked??w.autoMount;
  }
  function drawEditor(){
    const w=wizard,d=w.disk;w.plan=null;
    const destructive=['layout','format','delete'].includes(w.kind),editing=['layout','append','format'].includes(w.kind);
    dialogContent().innerHTML=`<p class="disk-selected"><strong>${esc(d.name)}</strong> · ${size(d.size)}<br>Serie: ${esc(d.serial||d.wwn)} · ${esc(w.part?.device||d.device)}</p>
      <ol class="disk-steps" aria-label="Pasos"><li aria-current="step">1. Configurar</li><li>2. Revisar</li><li>3. Comprobar</li></ol>
      ${destructive?`<div class="disk-warning"><strong>${w.kind==='layout'?'Se borrará todo el disco.':w.kind==='format'?'Se borrarán los archivos de esta partición.':'Se eliminará esta partición y se perderá el acceso a sus archivos.'}</strong><p>${w.kind==='layout'?'La distribución nueva reemplaza todas las particiones actuales.':w.kind==='format'?'Las otras particiones conservan su tamaño y su contenido.':'Las otras particiones se conservan.'} Guardá antes lo que quieras conservar. No tiene Deshacer.</p></div>`:w.kind==='append'?'<p class="disk-note">Se usa espacio sin particionar. Las particiones existentes conservan sus datos y su tamaño.</p>':w.kind==='unmount'?'<p class="disk-note">Deja de estar disponible para Archivos y otras aplicaciones hasta volver a montarla. Si hay archivos abiertos, AXON rechazará el desmontaje.</p>':''}
      ${editing?`<p>${w.kind==='format'?'Elegí el formato y el nombre de esta partición.':'Una partición divide el disco en espacios independientes. Podés usar uno para archivos y otro para respaldos.'}</p><div data-disk-rows>${w.rows.map((r,i)=>`<fieldset class="disk-editor-row" data-part-row="${i}"><legend>${w.kind==='format'?'Formato de la partición':'Partición '+(i+1)}</legend><div class="disk-fields"><label>Nombre<input name="name" maxlength="15" value="${esc(r.name)}" required placeholder="DATOS"></label><label>Formato<select name="filesystem">${data.formats.map(f=>`<option value="${esc(f.id)}" ${r.filesystem===f.id?'selected':''} ${f.available?'':'disabled'}>${esc(f.name)}${f.available?'':' · No disponible en el servidor'}</option>`).join('')}</select></label>${w.kind!=='format'?`<label>Tamaño en GiB<input name="size" type="number" min="0.063" step="0.1" value="${r.sizeMiB==null?'':r.sizeMiB/1024}" ${r.sizeMiB==null?'disabled':''}></label><label class="disk-check"><input type="checkbox" name="remaining" ${r.sizeMiB==null?'checked':''} ${i!==w.rows.length-1?'disabled':''}> Usar espacio restante</label>`:'<input name="size" type="hidden" value="0"><input name="remaining" type="checkbox" checked hidden>'}</div><p data-format-description>${esc(data.formats.find(f=>f.id===r.filesystem)?.description||'')}</p>${w.rows.length>1?`<button type="button" class="btn-secondary" data-remove-part="${i}">Quitar partición ${i+1}</button>`:''}</fieldset>`).join('')}</div>${['layout','append'].includes(w.kind)?`<button type="button" class="btn-secondary" data-add-part ${w.rows.length>=16?'disabled':''}>Agregar otra partición</button><p>Los tamaños se alinean para el disco. Podés dejar espacio sin particionar; no se agrandan ni se achican particiones existentes.</p>`:''}`:''}
      ${['layout','append','format','mount','configure'].includes(w.kind)?`<label class="disk-check disk-auto"><input type="checkbox" name="autoMount" ${data.canAutoMount===false?'disabled':''} ${w.autoMount?'checked':''}> Disponible automáticamente después de reiniciar</label><p>AXON reconoce la partición por su identificador. Si el disco falta, el servidor puede iniciar igual. El acceso se configura en la carpeta de discos de AXON.</p>`:''}
      <footer class="disk-dialog-actions"><button type="button" class="btn-secondary" data-edit-cancel>Cancelar</button><button type="button" class="btn-primary" data-review>Revisar cambios</button></footer>`;
    dialogContent().querySelector('[data-edit-cancel]').onclick=()=>dialog.close();
    dialogContent().querySelectorAll('[name=filesystem]').forEach(input=>input.onchange=()=>{input.closest('fieldset').querySelector('[data-format-description]').textContent=data.formats.find(f=>f.id===input.value)?.description||'';});
    dialogContent().querySelectorAll('[name=remaining]').forEach(input=>input.onchange=()=>{input.closest('fieldset').querySelector('[name=size]').disabled=input.checked;});
    dialogContent().querySelector('[data-add-part]')?.addEventListener('click',()=>{collect();const last=w.rows.at(-1);if(last.sizeMiB==null)last.sizeMiB=Math.max(64,Math.floor(((w.kind==='append'?(d.appendableBytes??d.size):d.size)/2**20-w.rows.reduce((sum,r)=>sum+(r.sizeMiB||0),0))/2));w.rows.push({name:'DATOS_'+(w.rows.length+1),filesystem:'ext4',sizeMiB:null});drawEditor();});
    dialogContent().querySelectorAll('[data-remove-part]').forEach(b=>b.onclick=()=>{collect();w.rows.splice(Number(b.dataset.removePart),1);drawEditor();});
    dialogContent().querySelector('[data-review]').onclick=review;
  }
  async function review(){
    const w=wizard;if(!w||w.busy)return;collect();
    const spec={diskId:w.disk.id,operation:w.kind,...(w.part?{partitionId:w.part.id}:{}),...(['layout','append'].includes(w.kind)?{partitions:w.rows}:{}),...(w.kind==='format'?{name:w.rows[0].name,filesystem:w.rows[0].filesystem}:{}),autoMount:w.autoMount};
    w.busy=true;dialogContent().querySelector('[data-review]').disabled=true;dialogStatus('Comprobando el disco y preparando la revisión…');
    try{const result=await api('/api/storage/disks/plans',{method:'POST',body:spec});if(wizard!==w||!dialog.open)return;w.plan=result.plan;drawReview();dialogStatus('Todavía no se modificó el disco.');}
    catch(e){dialogStatus(e.message,true);}finally{w.busy=false;dialogContent().querySelector('[data-review]')?.removeAttribute('disabled');}
  }
  function drawReview(){
    const w=wizard,p=w.plan,destructive=p.confirmation!=='CONFIRMAR';
    dialogContent().innerHTML=`<ol class="disk-steps" aria-label="Pasos"><li>1. Configurar</li><li aria-current="step">2. Revisar</li><li>3. Comprobar</li></ol><h3>${esc(labels[w.kind])}</h3><dl class="disk-review"><div><dt>Disco</dt><dd>${esc(p.diskName)} · ${size(w.disk.size)}</dd></div><div><dt>Número de serie</dt><dd>${esc(p.serial)}</dd></div><div><dt>Destino</dt><dd>${esc(w.part?.device||p.device)}</dd></div><div><dt>Montaje automático</dt><dd>${p.spec.autoMount?'Activado':'Desactivado'}</dd></div></dl>${p.spec.partitions.length?`<ul>${p.spec.partitions.map(r=>`<li><strong>${esc(r.name)}</strong> · ${esc(r.filesystem)} · ${r.sizeMiB==null?'Espacio restante':size(r.sizeMiB*2**20)}</li>`).join('')}</ul>`:''}<p>${w.kind==='layout'?'Se borran todos los datos y particiones actuales.':w.kind==='format'?'Se borran los archivos de la partición seleccionada.':w.kind==='delete'?'Se elimina la partición seleccionada.':'Se aplicará sólo la operación indicada.'}</p><p>La revisión vence en 10 minutos. AXON comprueba nuevamente la identidad y el uso del disco antes de ejecutar.</p>${destructive?`<label class="disk-confirm-label">Para confirmar, escribí <strong>${esc(p.confirmation)}</strong><input data-disk-confirm autocomplete="off" spellcheck="false" aria-label="Confirmación de borrado"></label>`:'<label class="disk-check"><input type="checkbox" data-disk-confirm> Confirmo esta operación sobre el disco indicado</label>'}<footer class="disk-dialog-actions"><button type="button" class="btn-secondary" data-back>Volver a configurar</button><button type="button" class="${destructive?'btn-danger':'btn-primary'}" data-execute disabled>${destructive?'Confirmar y borrar':'Confirmar operación'}</button></footer>`;
    dialogContent().querySelector('[data-back]').onclick=()=>{drawEditor();dialogStatus('');};
    const confirm=dialogContent().querySelector('[data-disk-confirm]');confirm.addEventListener(destructive?'input':'change',()=>{dialogContent().querySelector('[data-execute]').disabled=destructive?confirm.value!==p.confirmation:!confirm.checked;});
    dialogContent().querySelector('[data-execute]').onclick=execute;
    confirm.focus();
  }
  async function execute(){
    const w=wizard;if(!w?.plan||w.busy)return;w.busy=true;const p=w.plan;
    dialogContent().querySelector('[data-execute]').disabled=true;dialogContent().querySelector('[data-back]').disabled=true;dialogStatus('Enviando la confirmación…');
    try{const r=await api('/api/storage/disks/plans/'+p.id+'/execute',{method:'POST',body:{digest:p.digest,confirmation:p.confirmation}});if(!dialog.open||wizard!==w)return;wizard=null;operation=r.operation;drawOperation();await watch();}
    catch(e){dialogStatus(e.message+' Comprobá el historial antes de volver a intentar.',true);wizard=null;dialogContent().querySelector('[data-execute]').disabled=true;}
  }
  function drawOperation(){
    const o=operation;if(!o||!dialog.open)return;
    dialog.querySelector('#disk-dialog-title').textContent='Resultado de la operación';
    dialogContent().innerHTML=`<ol class="disk-steps" aria-label="Pasos"><li>1. Configurar</li><li>2. Revisar</li><li aria-current="step">3. Comprobar</li></ol><h3>${esc(states[o.state]||o.state)}</h3><p><strong>${esc(o.diskName)}</strong> · Serie ${esc(o.serial)}</p><p role="status">${esc(o.message)}</p>${o.fixture?'<p class="disk-note">Simulación: ningún disco real fue modificado.</p>':''}<ol class="disk-progress">${o.steps.map(s=>`<li>${esc(s.message)}</li>`).join('')}</ol>${o.paths?.map(p=>`<p><a class="btn-secondary" href="/archivos?path=${encodeURIComponent(p)}" data-open-result>Abrir ${esc(p)}</a></p>`).join('')||''}${['failed','interrupted'].includes(o.state)?'<p class="disk-warning">Puede haber cambios parciales. Conservá este resultado y revisá el disco. No se repite automáticamente.</p>':''}<p>Podés cerrar esta ventana. El trabajo continúa en el servidor y su resultado queda en el historial.</p>`;
    dialogContent().querySelectorAll('[data-open-result]').forEach(a=>a.addEventListener('click',()=>dialog.close()));
    dialogStatus('');
  }
  async function watch(){
    clearTimeout(poll);if(!operation||!dialog.open)return;const id=operation.id;
    if(operation.state==='running'){
      try{const r=await api('/api/storage/disks/operations/'+id,{fresh:true});if(operation?.id!==id||!dialog.open)return;operation=r.operation;drawOperation();}
      catch(e){dialogStatus(e.message+' El trabajo sigue en el servidor; podés consultar el historial.',true);}
      if(operation?.state==='running'&&dialog.open)poll=setTimeout(watch,1800);
    }
    if(operation?.state!=='running'){window.dispatchEvent(new Event('axon:disk-visibility'));await refresh();}
  }
  const bound=new WeakSet();
  function bind(){
    if(bound.has(root))return;bound.add(root);
    root.addEventListener('click',async e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-disk-refresh'))return refresh();
      if(b.dataset.visibility){b.disabled=true;try{await api('/api/storage/disks/visibility',{method:'POST',body:{key:b.dataset.visibility,hidden:b.dataset.hidden==='true'}});window.dispatchEvent(new Event('axon:disk-visibility'));await refresh();}catch(err){status(err.message,true);}finally{b.disabled=false;}return;}
      if(b.dataset.diskOperation){const d=data?.disks.find(d=>d.id===b.dataset.disk);if(d)startWizard(d,b.dataset.diskOperation,d.partitions.find(p=>p.id===b.dataset.partition),b);}
      if(b.dataset.diskResult){ensureDialog();returnFocus=b;dialogStatus('Cargando resultado…');dialog.showModal();try{const r=await api('/api/storage/disks/operations/'+b.dataset.diskResult,{fresh:true});operation=r.operation;drawOperation();watch();}catch(err){dialogStatus(err.message,true);}}
    });
  }
  window.AxonDisks={mount:async node=>{if(root!==node){root=node;bind();}render();await refresh();},leave:()=>{ticket++;root=null;busy=false;}};
})();
