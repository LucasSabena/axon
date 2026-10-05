/* Safe, selectable login output and shared xterm clipboard/link behavior. */
((root) => {
  'use strict';
  function clean(value) {
    return String(value || '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  }
  function urls(text) {
    const rows = [];
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
      const value = match[0].replace(/[.,;!?)\]}]+$/, '');
      try { const u = new URL(value); if (['http:', 'https:'].includes(u.protocol)) rows.push({ url: value, start: match.index, end: match.index + value.length }); } catch { /* incomplete output */ }
    }
    return rows;
  }
  async function copy(text) {
    if (!text) { root.toast?.('Seleccioná texto para copiar', 'error'); return; }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
        try { if (!document.execCommand('copy')) throw new Error('clipboard'); } finally { input.remove(); }
      }
      root.toast?.('Copiado', 'ok');
    } catch { root.toast?.('El navegador bloqueó el portapapeles. Seleccioná el texto y usá Ctrl/Cmd+C.', 'error'); }
  }
  function open(url) { try { if (['https:', 'http:'].includes(new URL(url).protocol)) window.open(url, '_blank', 'noopener,noreferrer'); } catch { /* invalid link */ } }
  function renderLog(pre, text) {
    if (pre.dataset.logText === text) return;
    const selection = window.getSelection();
    // Polling must never destroy a selection while the user is copying a link.
    if (selection && !selection.isCollapsed && pre.contains(selection.anchorNode)) return;
    const follow = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
    const frag = document.createDocumentFragment(); let offset = 0;
    for (const link of urls(text)) {
      frag.append(document.createTextNode(text.slice(offset, link.start)));
      const a = document.createElement('a'); a.href = link.url; a.textContent = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; frag.append(a); offset = link.end;
    }
    frag.append(document.createTextNode(text.slice(offset))); pre.replaceChildren(frag); pre.dataset.logText = text;
    if (follow) pre.scrollTop = pre.scrollHeight;
  }
  function attach(term, page) {
    term.attachCustomKeyEventHandler(e => {
      const key = e.key.toLowerCase(), modifier = e.ctrlKey || e.metaKey;
      if (modifier && key === 'c' && (term.hasSelection() || e.shiftKey)) {
        if (e.type === 'keydown') { e.preventDefault(); void copy(term.getSelection()); } return false;
      }
      // Leave native browser paste events in charge, avoiding double pastes.
      if (modifier && key === 'v') return false;
      return true;
    });
    page.addEventListener('contextmenu', e => {
      e.preventDefault();
      showCtxMenu([
        { icon: 'copy', label: 'Copiar selección', run: () => copy(term.getSelection()) },
        { icon: 'clipboard-paste', label: 'Pegar', run: () => paste(term) },
        { icon: 'text-select', label: 'Seleccionar todo', run: () => term.selectAll() },
      ], e.clientX, e.clientY);
    });
    term.registerLinkProvider({ provideLinks(y, callback) {
      const b = term.buffer.active, row = y - 1;
      let first = row, last = row;
      while (first > 0 && b.getLine(first)?.isWrapped && row - first < 32) first--;
      while (last + 1 < b.length && b.getLine(last + 1)?.isWrapped && last - first < 32) last++;
      let text = '';
      for (let i = first; i <= last; i++) text += b.getLine(i)?.translateToString(i === last) || '';
      callback(urls(text).map(link => ({ text: link.url, range: {
        start: { x: link.start % term.cols + 1, y: first + Math.floor(link.start / term.cols) + 1 },
        end: { x: (link.end - 1) % term.cols + 1, y: first + Math.floor((link.end - 1) / term.cols) + 1 },
      }, activate: (_e, url) => open(url) })));
    } });
  }
  async function paste(term) {
    try {
      const text = await navigator.clipboard.readText();
      if (text.includes('\n') && !(await confirmDialog('Pegar varias líneas', 'El texto contiene saltos de línea y puede ejecutar comandos en la terminal.', 'Pegar'))) return;
      term.paste(text); term.focus();
    } catch { toast('Usá Ctrl+Shift+V o Cmd+V para pegar desde el navegador.', 'error'); }
  }
  root.AxonTerminalTools = { clean, urls, copy, open, renderLog, attach, paste };
})(typeof window === 'undefined' ? globalThis : window);
