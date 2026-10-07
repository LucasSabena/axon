/* Shared reviewed transfers for Files, Library, rename and undo/redo. */
(() => {
  'use strict';
  const cancelled = () => Object.assign(new Error('Movimiento cancelado'), { cancelled:true });
  let flight = Promise.resolve();
  function dialog({ title, body, accept, error=false, setup }) {
    const work = async () => {
      await customElements.whenDefined('wa-dialog');
      const trigger=document.activeElement, el=document.createElement('wa-dialog');
      el.className='operation-dialog';el.label=title;
      el.innerHTML=`<span slot="label">${esc(title)}</span><div class="operation-body">${body}</div><div slot="footer" class="operation-actions">${error?'<wa-button class="operation-copy" appearance="plain">Copiar detalle</wa-button>':''}<wa-button class="operation-cancel" appearance="outlined">${error?'Cerrar':'Cancelar'}</wa-button>${accept?`<wa-button class="operation-accept" variant="brand">${esc(accept)}</wa-button>`:''}</div>`;
      document.body.append(el);await el.updateComplete;refreshIcons();
      return new Promise(resolve=>{
        let settled=false;const cleanup=setup?.(el);
        const done=value=>{if(settled)return;settled=true;cleanup?.();el.addEventListener('wa-after-hide',()=>{el.remove();if(trigger?.isConnected){trigger.focus({preventScroll:true});setTimeout(()=>trigger.isConnected&&trigger.focus({preventScroll:true}),0);}resolve(value);},{once:true});el.open=false;};
        el.querySelector('.operation-cancel').onclick=()=>done(false);
        el.querySelector('.operation-accept')?.addEventListener('click',()=>done(true));
        el.querySelector('.operation-copy')?.addEventListener('click',async()=>{
          const button=el.querySelector('.operation-copy');
          try{await navigator.clipboard.writeText(`${title}\n${el.querySelector('.operation-body').innerText}`);button.textContent='Copiado';}catch{button.textContent='Seleccioná el texto para copiar';}
        });
        el.addEventListener('wa-hide',()=>done(false));
        el.addEventListener('wa-after-show',()=>el.querySelector('.operation-cancel').focus(),{once:true});
        el.open=true;
      });
    };
    const result=flight.then(work);flight=result.catch(()=>{});return result;
  }
  const locations=(from,to)=>`<div class="operation-locations"><div><span>Origen</span><code>${esc(from)}</code></div><div><span>Destino</span><code>${esc(to)}</code></div></div>`;
  const pctOf=op=>Math.max(0,Math.min(100,Math.floor(Number(op.copiedBytes||0)*100/Math.max(1,Number(op.logicalBytes||0)))));
  const fmtEta=s=>{s=Math.round(s);if(s<60)return `${Math.max(1,s)}s`;if(s<3600)return `${Math.ceil(s/60)}min`;return `${Math.floor(s/60)}min`;};
  // ETA from the byte delta between two status samples over real elapsed ms.
  const etaFor=(copiedBefore,op,ms)=>{const d=Number(op.copiedBytes||0)-copiedBefore;if(d<=0||ms<=0)return'';const left=(Number(op.logicalBytes||0)-Number(op.copiedBytes||0))/(d/ms*1000);return Number.isFinite(left)&&left>1?fmtEta(left):'';};
  async function review(plan){
    const r=plan.review;if(!r?.needsConfirmation)return true;
    const changes=r.impacts.map(i=>`<details class="operation-impact${i.kind==='configuration'?' operation-impact-warning':''}"${i.kind==='configuration'?' open':''}><summary><span>${esc(i.title)}</span><span class="operation-count">${i.kind==='configuration'?'Revisar':i.paths.length}</span></summary><p>${esc(i.detail)}</p><ul>${i.paths.map(p=>`<li><code>${esc(p.from)}</code>${p.from!==p.to?`<span aria-hidden="true">→</span><code>${esc(p.to)}</code>`:''}</li>`).join('')}</ul></details>`).join('');
    return dialog({title:'Revisar movimiento',accept:'Aceptar y mover',body:`<div class="operation-intro">${icon('folder-input')}<p>Este movimiento afecta referencias de AXON. Revisá los cambios automáticos y las rutas que necesitarán tu atención.</p></div>${locations(plan.from,plan.to)}${r.addRoots.length?`<div class="operation-notice">${icon('library')}<div><b>Conservar el acceso desde Biblioteca</b><p>Se incorporará ${r.addRoots.map(p=>`<code>${esc(p)}</code>`).join(', ')} a sus carpetas. Se indexará su contenido; los links existentes conservarán sus permisos.</p></div></div>`:''}<h4>Qué se verá afectado</h4>${changes}<p class="operation-footnote">Si cancelás, no se mueve nada. El servidor vuelve a comprobar las referencias antes de iniciar. Los programas externos pueden tener otras referencias que AXON no registra.</p>`});
  }
  async function showPending(pending,message){
    let lastCopied=null,lastT=0;
    const render=op=>{
      const state={running:'En curso',planned:'Preparando',verified:'Completado',failed:'No completado',interrupted:'Necesita revisión',skipped:'Cancelado',restored:'Original recuperado'}[op.state]||'Pendiente de comprobar';
      const now=Date.now(),pct=pctOf(op),eta=lastCopied!=null?etaFor(lastCopied,op,now-lastT):'';
      lastCopied=Number(op.copiedBytes||0);lastT=now;
      const finished=['verified','restored','failed','skipped'].includes(op.state)&&!op.referencesPending;
      return `<div class="operation-notice"><div><b>${esc(state)}</b>${op.state==='running'?`<progress aria-label="Progreso de la transferencia" max="100" value="${pct}"></progress><p>${pct}% copiado${eta?` · quedan ~${eta}`:''} · la verificación puede continuar después</p><p><button type="button" class="btn-secondary operation-abort">Cancelar este trabajo</button></p>`:''}<p>${esc(op.message||(finished?'El resultado ya se comprobó. Podés cerrar y volver a intentar la acción.':'AXON está comprobando este trabajo. La acción solicitada todavía no se realizó.'))}</p>${op.partialPath?`<p>Copia parcial conservada: <code>${esc(op.partialPath)}</code></p>`:''}</div></div>`;
    };
    const value=await dialog({title:'Hay un trabajo pendiente',error:true,accept:pending?'Ver historial':undefined,body:`<div class="operation-intro">${icon('clock-3')}<p>${esc(message)}</p></div>${pending?.from?locations(pending.from,pending.to||'Papelera'):''}<div class="operation-live-status">${pending?render(pending):'<p>Comprobá el historial de Archivos y Almacenamiento. No se repite automáticamente ninguna acción.</p>'}</div><p class="operation-footnote">Si hay un resultado incierto, se conserva el bloqueo para proteger los archivos. AXON no borra originales ni copias parciales al comprobar un trabajo.</p>`,setup:el=>{
      if(pending?.kind!=='transfer')return;
      let stopped=false,busy=false;
      el.querySelector('.operation-live-status').addEventListener('click',async e=>{
        if(!e.target.closest('.operation-abort'))return;
        const b=e.target.closest('.operation-abort');b.disabled=true;
        if(!await confirmDialog('Cancelar el trabajo','Se detiene la transferencia en curso. Lo ya copiado se revisa y no se borran originales.','Cancelar trabajo')){b.disabled=false;return;}
        try{await api(`/api/files/copyjob/${pending.id}`,{method:'DELETE'});}catch(err){errToast(err);}
      });
      const check=async()=>{if(stopped||busy)return;busy=true;try{
        const {operation}=await api(`/api/files/transfers/${pending.id}`,{fresh:true});if(stopped)return;
        el.querySelector('.operation-live-status').innerHTML=render(operation);
      }catch(error){if(error.status===401){stopped=true;clearInterval(timer);return;}if(!stopped)el.querySelector('.operation-live-status').textContent=error.message;}finally{busy=false;}};
      void check();const timer=setInterval(check,3000);return()=>{stopped=true;clearInterval(timer);};
    }});
    if(value){await window.AxonNavigation.go(pending.kind==='transfer'?'/archivos':'/almacenamiento');const history=document.getElementById('fm-transfer-history');if(history){history.open=true;history.scrollIntoView({block:'center'});}}
  }
  async function showError(error,context={}){
    if(error.cancelled)return;
    if(error.raw?.code==='operation-pending')return showPending(error.raw.pending,error.message);
    const blockers=error.raw?.blockers;
    return dialog({title:context.mode==='copy'?'No se pudo copiar':context.mode==='move'?'No se pudo mover':'No se pudo completar la acción',error:true,body:`<div class="operation-intro operation-error">${icon('circle-alert')}<p>${esc(error.message||'Reintentá la acción.')}</p></div>${context.from?locations(context.from,context.to):''}${Array.isArray(blockers)&&blockers.length?`<details class="operation-impact" open><summary>Elementos incompatibles (${blockers.length})</summary><ul>${blockers.map(b=>`<li><code>${esc(b.path)}</code><p>${esc(b.reason)}</p></li>`).join('')}</ul></details>`:''}${error.detail?`<details class="operation-impact"><summary>Detalle técnico</summary><pre>${esc(error.detail)}</pre></details>`:''}<p class="operation-footnote">Revisá la causa antes de volver a intentarlo. Si el trabajo llegó a iniciarse, comprobá su resultado en el historial de transferencias.</p>`});
  }
  async function start(from,to,mode='move',options={}){
    const {plan}=await api('/api/files/transfers/plans',{method:'POST',body:{from,to,mode,...options}});
    if(!await review(plan))throw cancelled();
    const {operation}=await api(`/api/files/transfers/${plan.id}/execute`,{method:'POST',body:{digest:plan.digest,...(plan.review?.needsConfirmation?{reviewDigest:plan.review.revision}:{})}});
    return operation;
  }
  async function run(from,to,mode='move',options={}){
    const {timeoutMs=10*60*1000,onProgress,...rest}=options;
    let operation=await start(from,to,mode,rest);
    let lastCopied=Number(operation.copiedBytes||0),lastT=Date.now();
    onProgress?.(operation,{pct:pctOf(operation)});
    const deadline=Date.now()+timeoutMs;
    while(['running','planned'].includes(operation.state)||operation.referencesPending){
      if(Date.now()>=deadline){
        const pct=pctOf(operation);
        throw Object.assign(new Error(`El trabajo sigue sin terminar después de ${Math.max(1,Math.round(timeoutMs/60000))} min (${pct}% copiado). El seguimiento continúa en el historial de transferencias.`),{raw:{code:'operation-pending',pending:{...operation,kind:'transfer'}}});
      }
      await new Promise(resolve=>setTimeout(resolve,500));
      const next=(await api(`/api/files/transfers/${operation.id}`)).operation;
      const now=Date.now(),info={pct:pctOf(next),eta:etaFor(lastCopied,next,now-lastT)};
      lastCopied=Number(next.copiedBytes||0);lastT=now;operation=next;
      onProgress?.(operation,info);
    }
    if(operation.state!=='verified')throw new Error(operation.message||'Revisá el historial de transferencias.');
    return operation;
  }
  async function cancel(id){return api(`/api/files/copyjob/${encodeURIComponent(id)}`,{method:'DELETE'});}
  window.AxonTransfers={start,run,cancel,review,showError};
})();
