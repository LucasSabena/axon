(() => {
  'use strict';
  // Filters operate on the current snapshot and survive live refreshes.
  for (const [section, label] of [['ports','puertos, proceso o carpeta'],['projects','proyecto o carpeta'],['docker','contenedor o imagen'],['domains','dominio o destino'],['programs','programa o herramienta']]) {
    const sec=document.querySelector(`#tab-${section}`); if(!sec)continue;
    const bar=document.createElement('div'); bar.className='view-tools';
    bar.innerHTML=`<input type="search" class="filter-input" aria-label="Buscar ${label}" placeholder="Buscar ${label}…"><select aria-label="Filtrar ${section}">${section==='programs'?'<option value="all">Todos los programas</option><option value="installed">Instalados</option><option value="updates">Con actualizaciones</option><option value="available">Disponibles</option>':section==='docker'||section==='projects'?'<option value="all">Todos los estados</option><option value="running">En ejecución</option><option value="stopped">Detenidos</option>':'<option value="all">Todos</option>'}</select><span class="last-updated" role="status"></span>`;
    sec.querySelector('.section-header').after(bar);
    const input=bar.querySelector('input'), select=bar.querySelector('select');
    function filter(){
      const query=input.value.trim().toLocaleLowerCase('es-AR');
      const rows=[...sec.querySelectorAll(section==='programs'?'.program-card':`#${section}-table tbody > tr`)];
      let shown=0;
      rows.forEach(row=>{
        const text=row.textContent.toLocaleLowerCase('es-AR');
        const state=select.value;
        const running=row.querySelector('.badge-status-running') || /\brunning\b|corriendo/.test(text);
        const match=!query || text.includes(query);
        const stateMatch=state==='all'||state==='installed'&&!row.classList.contains('program-off')||state==='available'&&row.classList.contains('program-off')||state==='updates'&&row.classList.contains('has-update')||state==='running'&&running||state==='stopped'&&!running;
        row.hidden=!match||!stateMatch;if(!row.hidden)shown++;
      });
      bar.querySelector('[role=status]').textContent=query||select.value!=='all'?`${shown} coincidencias`:'';
    }
    input.addEventListener('input',filter); select.addEventListener('change',filter);
    const target=sec.querySelector(section==='programs'?'#programs-grid':`#${section}-table tbody`);
    if(target)new MutationObserver(filter).observe(target,{childList:true,subtree:false});
    if(['projects','docker','domains'].includes(section)){
      const refresh=document.createElement('button'); refresh.className='btn-secondary'; refresh.title='Actualizar'; refresh.setAttribute('aria-label',`Actualizar ${section}`); refresh.innerHTML=icon('refresh-cw');
      refresh.addEventListener('click',()=>AxonUI.busy(refresh,()=>loaders[section]()));bar.append(refresh);
    }
  }
  const toolbar=document.createElement('div');toolbar.className='term-toolbar';
  toolbar.innerHTML='<span id="term-connection" class="term-state" role="status">Sin sesión</span><button class="btn-secondary" id="term-reconnect">Reconectar</button><button class="btn-secondary" id="term-clear">Limpiar pantalla</button><button class="btn-secondary" id="term-copy">Copiar</button><button class="btn-secondary" id="term-paste">Pegar</button><button class="btn-secondary" id="term-select">Seleccionar todo</button><span class="term-hint">Ctrl/Cmd+C copia la selección · Shift+arrastrar selecciona cuando un programa captura el mouse</span>';
  document.querySelector('#tab-terminal').prepend(toolbar);
  document.querySelector('#term-reconnect').addEventListener('click',()=>{const s=termSessions.get(activeTerm);if(s)connectTermTab(s);});
  document.querySelector('#term-clear').addEventListener('click',()=>termSessions.get(activeTerm)?.term.clear());
  document.querySelector('#term-copy').addEventListener('click',()=>{const s=termSessions.get(activeTerm);if(!s)return;if(s.term.hasSelection())return AxonTerminalTools.copy(s.term.getSelection());const b=s.term.buffer.active;const lines=[];for(let i=Math.max(0,b.length-2000);i<b.length;i++)lines.push(b.getLine(i)?.translateToString(true)||'');return AxonTerminalTools.copy(lines.join('\n'));});
  document.querySelector('#term-paste').addEventListener('click',()=>{const s=termSessions.get(activeTerm);if(s)AxonTerminalTools.paste(s.term);});
  document.querySelector('#term-select').addEventListener('click',()=>termSessions.get(activeTerm)?.term.selectAll());
  const progress=document.createElement('div');progress.className='section-progress hidden';progress.id='section-progress';progress.setAttribute('role','status');progress.innerHTML=`${icon('loader','spin')} <span>Cargando datos…</span>`;
  document.querySelector('main.content').prepend(progress);
  document.addEventListener('axon:section',e=>{
    const section=e.detail;
    const sec=document.querySelector(`#tab-${section}`);
    const empty=!sec?.querySelector('tbody tr, .program-card, .lib-tile, .fm-row, .agent-row');
    if(!['ports','projects','docker','domains','programs'].includes(section)){progress.classList.add('hidden');return;}
    progress.classList.toggle('hidden',!empty);
    const target=sec.querySelector('tbody, #programs-grid');
    if(target){const o=new MutationObserver(()=>{progress.classList.add('hidden');o.disconnect();});o.observe(target,{childList:true});setTimeout(()=>{o.disconnect();progress.classList.add('hidden');},90_000);}
  });
  const browserForm=document.createElement('form');browserForm.className='view-tools';browserForm.innerHTML='<input type="url" class="filter-input" aria-label="URL para abrir en el servidor" placeholder="https://… o http://localhost:puerto" required><button class="btn-primary" type="submit">Abrir en el servidor</button>';
  document.querySelector('#tab-navegador .browser-note').after(browserForm);
  browserForm.addEventListener('submit',e=>{e.preventDefault();AxonUI.busy(browserForm.querySelector('button'),()=>openInServerBrowser(browserForm.querySelector('input').value));});
  refreshIcons();
})();
