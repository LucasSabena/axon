/* Shared transport: bounded memory, one flight per GET, invalidation after writes. */
(function (root) {
  'use strict';
  function create({ fetcher = fetch, now = Date.now, onStart = () => {}, onEnd = () => {}, onError = () => {}, onAuth = () => {} } = {}) {
    const flights = new Map(), cache = new Map();
    let generation = 0;
    function invalidate() { generation++; cache.clear(); flights.clear(); }
    function request(path, opts = {}) {
      const method = (opts.method || 'GET').toUpperCase();
      const ttl = opts.cacheMs || 0;
      const key = `${method}:${path}:${JSON.stringify(opts.headers || {})}`;
      const reusable = method === 'GET' && !opts.signal;
      const hit = cache.get(key);
      const finish = onStart(path, opts);
      const observe = promise => promise.catch(error => { onError(path,error); throw error; }).finally(() => { finish?.(); onEnd(path); });
      if (reusable && !opts.fresh && ttl && hit && now() - hit.at < ttl) return observe(Promise.resolve(hit.data));
      if (reusable && flights.has(key)) return observe(flights.get(key));
      const stamp = generation;
      const task = (async () => {
        let response;
        try {
          const { cacheMs, fresh, busy, timeoutMs, ...init } = opts;
          response = await fetcher(path, {
            credentials: 'same-origin', cache: 'no-store', ...init, method,
            headers: { ...(opts.body != null ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
            body: opts.body != null ? JSON.stringify(opts.body) : undefined,
            signal: opts.signal || AbortSignal.timeout(timeoutMs || 90_000),
          });
        } catch (cause) {
          throw new Error(cause.name === 'TimeoutError' ? 'El servidor está tardando demasiado. Podés reintentar.' : 'Sin conexión con el servidor', { cause });
        }
        let data;
        try { data = await response.json(); }
        catch {
          if (response.status === 401) { invalidate(); onAuth(); }
          throw Object.assign(new Error('El servidor devolvió una respuesta incompleta. Podés reintentar.'), { status: response.status });
        }
        if (!data || typeof data !== 'object') throw new Error('El servidor devolvió una respuesta incompleta. Podés reintentar.');
        if (!response.ok || data.ok === false) {
          const error = Object.assign(new Error(data.error || `HTTP ${response.status}`), {
            status: response.status, detail: data.detail, command: data.command, raw: data,
          });
          if (response.status === 401) { invalidate(); onAuth(); }
          throw error;
        }
        if (method !== 'GET') invalidate();
        else if (ttl && stamp === generation) {
          if (cache.size >= 64) cache.delete(cache.keys().next().value);
          cache.set(key, { at: now(), data });
        }
        return data;
      })().finally(() => {
        if (flights.get(key) === task) flights.delete(key);
      });
      if (reusable) flights.set(key, task);
      return observe(task);
    }
    return { request, invalidate };
  }
  root.AxonRequestClient = { create };
})(globalThis);
