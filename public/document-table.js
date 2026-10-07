// CSV/TSV is data, never HTML or executable spreadsheet formulas.
export function parseDelimited(source, separator = '') {
  source = String(source).replace(/^\uFEFF/, '');
  if (!separator) {
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let quoted = false;
    // The header is stronger evidence than body punctuation (decimal commas
    // in semicolon-separated exports must not become extra columns).
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') { if (quoted && source[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted) { if (c in counts) counts[c]++; if ((c === '\n' || c === '\r') && Object.values(counts).some(Boolean)) break; }
    }
    separator = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }
  const rows = []; let row = [], value = '', quoted = false, cells = 0, truncated = false, stopped = false;
  const cell = () => { if (row.length < 100) row.push(value); else truncated = true; value = ''; cells++; };
  const line = () => { cell(); rows.push(row); row = []; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { value += '"'; i++; } else quoted = false; }
      else value += c;
    } else if (c === '"' && value === '') quoted = true;
    else if (c === separator) cell();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      line();
      if (rows.length >= 10000 || cells >= 100000) { truncated ||= i < source.length - 1; stopped = true; break; }
    } else value += c;
  }
  if (quoted && !stopped) throw new Error('La tabla tiene una celda entre comillas sin cerrar.');
  if (!stopped && (value || row.length || (source && !/[\r\n]$/.test(source)))) line();
  return { rows, separator, truncated };
}

export async function readTable(response, signal) {
  if (!response.ok) throw new Error('No se pudo leer la tabla.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) throw new Error('El visor de tablas admite hasta 5 MB. Podés descargar el original.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (bytes[0] === 255 && bytes[1] === 254) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16' };
  if (bytes[0] === 254 && bytes[1] === 255) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'UTF-16' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }; }
  catch { return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' }; }
}
