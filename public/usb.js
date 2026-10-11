(() => {
  'use strict';
  window.AxonUsb = {
    mount(pane) {
      const node = document.createElement('div'); node.id = 'usb-controller'; pane.append(node);
      node.innerHTML = '<div class="device-toolbar"><button type="button" class="btn-secondary" data-refresh>Actualizar</button><label class="usb-show-internal"><input type="checkbox" data-internal data-local> Ver puertos internos y no utilizados</label></div><p data-message role="status">Consultando puertos USB…</p><p data-note class="settings-help"></p><div data-missing></div><div data-job role="status"></div><div data-ports></div><p class="settings-help">Los canales USB 2 y USB 3 del mismo conector se controlan juntos. La reconexión tarda 5 segundos; la desconexión temporal vuelve a habilitar el puerto a los 30 segundos, aunque cierres AXON. Los discos montados y los dispositivos de red o entrada están protegidos.</p>';
      let state = null, busy = false, ticket = 0, timer;
      const visible = () => node.isConnected && node.getClientRects().length > 0;
      const active = () => state?.job && ['queued','running','restoring','disconnected'].includes(state.job.state);
      function render() {
        node.querySelector('[data-note]').textContent = state?.note || '';
        const missing = state?.expectedVolumes?.filter(v => !v.detected) || [];
        node.querySelector('[data-missing]').innerHTML = missing.length ? `<p class="usb-missing">Discos configurados que el sistema no detecta: ${missing.map(v=>`<code>${esc(v.path)}</code>`).join(', ')}. Reconectar el puerto puede ayudar; si sigue ausente y no hay corte eléctrico disponible, necesita una reconexión física.</p>` : '';
        const job = state?.job, labels = {queued:'En espera',running:'Desconectando',disconnected:'Desconectado temporalmente',restoring:'Restableciendo el puerto',completed:'Puerto habilitado. Revisá si apareció el dispositivo.',failed:'La operación no se confirmó'};
        node.querySelector('[data-job]').textContent = job ? `${job.port}: ${labels[job.state] || job.state}${job.error ? ' · ' + job.error : ''}` : '';
        const internal = node.querySelector('[data-internal]').checked;
        node.querySelector('[data-ports]').innerHTML = (state?.ports || []).filter(p => p.external || internal).map(p => {
          const devices = p.devices.map(d=>`${d.name}${d.speed ? ' · '+d.speed+' Mb/s' : ''}`);
          const disks = p.disks?.map(b=>`${b.labels?.join(', ') || b.model || b.name}${b.mounted ? ' · Montado' : ''}`).filter(Boolean) || [];
          const disabled = busy || active();
          return `<article class="usb-port" data-port="${esc(p.id)}"><div class="usb-port-info"><div class="session-heading"><strong>${esc(p.id)}</strong><span class="session-state">${p.external ? 'Externo' : 'Protegido'}</span></div><p>${esc(devices.join(' / ') || 'Sin dispositivo detectado')}${disks.length ? '<br>'+esc(disks.join(' / ')) : ''}</p><p class="settings-help">${p.ports.length > 1 ? 'Canales: '+esc(p.ports.join(' + '))+' · ' : ''}${p.powerSwitching === false ? 'Corte eléctrico no disponible' : 'Corte eléctrico sin verificar'}${p.remainingSeconds != null ? ' · Reactivación en '+p.remainingSeconds+' s' : ''}</p>${p.reason ? `<p class="settings-help">${esc(p.reason)}</p>` : ''}</div>${p.external ? `<div class="usb-port-actions"><button type="button" class="btn-secondary" data-operation="cycle"${disabled || !p.canDisconnect ? ' disabled' : ''}>Reconectar</button><button type="button" class="btn-secondary" data-operation="disconnect"${disabled || !p.canDisconnect ? ' disabled' : ''}>Desconectar 30 s</button><button type="button" class="btn-secondary" data-operation="enable"${busy || active() && job.port !== p.id ? ' disabled' : ''}>Habilitar</button></div>` : ''}</article>`;
        }).join('') || '<p class="settings-help">No hay puertos para mostrar.</p>';
        node.querySelectorAll('[data-operation]').forEach(button => button.onclick = async () => {
          const p = state.ports.find(p=>p.id === button.closest('[data-port]').dataset.port), operation = button.dataset.operation;
          if (operation !== 'enable' && !await confirmDialog(operation === 'cycle' ? 'Reconectar puerto USB' : 'Desconectar puerto USB', `Se interrumpirá la conexión de ${p.ports.join(' + ')} y todos sus dispositivos durante ${operation === 'cycle' ? '5' : '30'} segundos. ${p.powerSwitching === false ? 'El puerto conservará alimentación eléctrica.' : 'No se confirmó que el puerto pueda cortar la alimentación.'}`, operation === 'cycle' ? 'Reconectar' : 'Desconectar 30 s')) return;
          busy = true; ++ticket; clearTimeout(timer); render();
          try { await api('/api/usb', {method:'POST',body:{id:p.id,token:p.token,operation,...(operation==='disconnect'?{seconds:30}:{})}}); }
          catch(e) { node.querySelector('[data-message]').textContent = e.message; node.querySelector('[data-message]').setAttribute('role','alert'); }
          finally { busy = false; await refresh(); }
        });
      }
      async function refresh() {
        clearTimeout(timer); if (busy || !visible()) return;
        const id = ++ticket; node.setAttribute('aria-busy','true');
        try { const r = await api('/api/usb'); if(id!==ticket || !visible())return; state=r;render();node.querySelector('[data-message]').textContent='Actualizado '+new Date().toLocaleTimeString('es-AR');node.querySelector('[data-message]').setAttribute('role','status'); }
        catch(e) { if(id===ticket){state=null;render();node.querySelector('[data-message]').textContent=e.message;node.querySelector('[data-message]').setAttribute('role','alert');} }
        finally {if(id===ticket){node.removeAttribute('aria-busy');timer=setTimeout(refresh,active()?1000:10000);} }
      }
      node.querySelector('[data-refresh]').onclick=refresh;
      node.querySelector('[data-internal]').onchange=render;
      document.addEventListener('axon:session-expired',()=>{++ticket;clearTimeout(timer);state=null;render();});
      return {refresh};
    }
  };
})();
