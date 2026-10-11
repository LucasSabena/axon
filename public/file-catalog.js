/* Shared personal organization for Archivos and Biblioteca. */
(() => {
  'use strict';
  const colors={red:'Rojo',orange:'Naranja',yellow:'Amarillo',green:'Verde',blue:'Azul',purple:'Violeta',pink:'Rosa',gray:'Gris'};
  const marks={favorite:['star','Favoritos'],liked:['heart','Me gusta'],saved:['bookmark','Guardados'],pinned:['pin','Acceso rápido']};
  const empty=()=>({color:'',tags:[],favorite:false,liked:false,saved:false,pinned:false,revision:0});
  let rows=[],byPath=new Map(),at=0,flight,signature='',generation=0;
  const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('axon-file-catalog'):null;
  async function load(fresh=false){
    if(flight){if(!fresh)return flight;await flight.catch(()=>{});return load(true);}
    if(!fresh&&Date.now()-at<15000)return rows;
    const stamp=generation;
    return flight=api('/api/file-catalog').then(d=>{if(stamp!==generation)return rows;const next=d.entries.map(r=>r.path+':'+r.available+':'+r.metadata.revision).join('|'),changed=next!==signature;signature=next;rows=d.entries;byPath=new Map(rows.filter(r=>r.available).map(r=>[r.path,r.metadata]));at=Date.now();if(changed)document.dispatchEvent(new CustomEvent('axon:catalog'));return rows;}).catch(e=>{rows=[];byPath.clear();at=0;throw e;}).finally(()=>{flight=null;});
  }
  const get=p=>byPath.get(p)||empty();
  const attr=p=>` data-file-color="${esc(get(p).color)}"`;
  const badges=p=>{const m=get(p);return `<span class="file-badges">${Object.entries(marks).filter(([k])=>m[k]).map(([k,[ic,label]])=>`<span title="${label}" aria-label="${label}">${icon(ic)}</span>`).join('')}${m.tags.slice(0,3).map(t=>`<span class="file-tag">${esc(t)}</span>`).join('')}${m.tags.length>3?`<span title="${esc(m.tags.join(', '))}">+${m.tags.length-3}</span>`:''}</span>`;};
  async function patch(paths,value){generation++;const d=await api('/api/file-catalog',{method:'PATCH',body:{paths,patch:value}});await load(true);channel?.postMessage('changed');return d;}
  channel?.addEventListener('message',()=>{at=0;load(true).then(()=>document.dispatchEvent(new CustomEvent('axon:catalog'))).catch(()=>{});});
  document.addEventListener('axon:session-expired',()=>{generation++;rows=[];byPath.clear();at=0;signature='';document.querySelectorAll('.catalog-dialog').forEach(d=>d.close());});
  const parse=v=>v.split(',').map(t=>t.trim()).filter(Boolean);
  function edit(paths,adapter){
    paths=[...new Set(paths)];if(!paths.length)return;if(paths.length>200){toast('Elegí hasta 200 elementos para organizar a la vez','warn');return;}
    const single=paths.length===1,m=(adapter?.get||get)(paths[0]),focus=document.activeElement;
    const dialog=document.createElement('dialog');dialog.className='catalog-dialog';
    dialog.setAttribute('aria-label',single?'Organizar '+paths[0].split('/').pop():'Organizar '+paths.length+' elementos');
    dialog.innerHTML=`<form class="catalog-form"><div class="catalog-heading"><div><h3>Organizar ${single?esc(paths[0].split('/').pop()):paths.length+' elementos'}</h3><p>${adapter?'Marcas personales guardadas en AXON para esta cuenta de nube.':'Se comparte entre Archivos y Biblioteca para tu usuario.'}</p></div><button type="button" class="icon-btn" data-close aria-label="Cerrar">${icon('x')}</button></div><fieldset><legend>Color</legend><div class="catalog-colors">${single?'':`<label><input type="radio" name="color" value="keep" checked>Conservar</label>`}${[['','Sin color'],...Object.entries(colors)].map(([c,label])=>`<label data-file-color="${c}"><input type="radio" name="color" value="${c}"${single&&m.color===c?' checked':''}><span class="file-dot"></span>${label}</label>`).join('')}</div></fieldset><label>${single?'Etiquetas':'Agregar etiquetas'}<input name="tags" maxlength="820" value="${single?esc(m.tags.join(', ')):''}" placeholder="Trabajo, Fotos, Pendiente"><small>Separalas con comas. Hasta 20 etiquetas por elemento.</small></label>${single?'':`<label>Quitar etiquetas<input name="removeTags" maxlength="820" placeholder="Etiquetas a quitar"></label>`}<fieldset><legend>Marcas personales</legend><div class="catalog-marks">${Object.entries(marks).map(([k,[ic,label]])=>single?`<label><input type="checkbox" name="${k}"${m[k]?' checked':''}>${icon(ic)}${label}</label>`:`<label>${icon(ic)}${label}<select name="${k}"><option value="keep">Conservar</option><option value="true">Marcar</option><option value="false">Quitar</option></select></label>`).join('')}</div></fieldset><p class="catalog-error" role="alert" hidden></p><div class="catalog-actions"><button type="button" class="btn-secondary" data-close>Cancelar</button><button class="btn-primary" type="submit">Guardar organización</button></div></form>`;
    const close=()=>dialog.close();dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);dialog.addEventListener('close',()=>{dialog.remove();focus?.focus();});dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
    document.body.append(dialog);dialog.showModal();refreshIcons();
    dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const f=e.currentTarget,value={};const color=f.elements.color.value;if(color!=='keep')value.color=color;
      if(single){value.tags=parse(f.elements.tags.value);value.revision=m.revision;}else{value.addTags=parse(f.elements.tags.value);value.removeTags=parse(f.elements.removeTags.value);}
      for(const k of Object.keys(marks)){const field=f.elements[k];if(single)value[k]=field.checked;else if(field.value!=='keep')value[k]=field.value==='true';}
      AxonUI.busy(f.querySelector('[type=submit]'),async()=>{try{await (adapter?.patch||patch)(paths,value);close();toast('Organización guardada','ok');}catch(err){const box=f.querySelector('[role=alert]');box.hidden=false;box.textContent=err.message;}});
    };
  }
  function matches(p,{mark='',color='',tag='',kind='',query=''}={},type='file'){
    const m=get(p);return (!mark||m[mark])&&(!color||m.color===color)&&(!tag||m.tags.includes(tag))&&(!kind||type===kind)&&(!query||query.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'').split(/\s+/).every(t=>(p+' '+m.tags.join(' ')).toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu,'').includes(t)));
  }
  window.AxonFileCatalog={load,get,attr,badges,edit,patch,matches,colors,marks,entries:()=>rows,tags:()=>[...new Set(rows.filter(r=>r.available).flatMap(r=>r.metadata.tags))].sort((a,b)=>a.localeCompare(b,'es'))};
})();
