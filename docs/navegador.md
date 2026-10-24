# Navegador del servidor

La pestaña **Navegador** muestra un Google Chrome que corre en el host, con sesiones persistentes compartidas entre el usuario y los agentes.

## Qué hay en el host

Los archivos viven en `~/server-stack/navegador/` y corren como servicios `systemd --user`:

- `navegador.service` (`navegador.sh`): Xvfb `:88` + openbox + Google Chrome (perfil `~/.config/navegador-chrome`) + x11vnc + websockify/noVNC en `127.0.0.1:5800`. CDP en `127.0.0.1:9222`. Con `KillMode=mixed`, el script cierra Chrome antes que la pantalla virtual. Si Chrome muere sin guardar la cookie que Google acaba de rotar (`__Secure-1PSIDTS`), Google invalida la sesión. Chrome corre con `--disable-gpu`: sin eso emula una GPU por software y consume un núcleo entero aunque no haga nada.
- `playwright-navegador-mcp.service`: Playwright MCP en `127.0.0.1:8932` conectado por CDP. Se desconecta a los 10 min sin uso y no cierra Chrome.
- `playwright-agents-mcp.service`: Playwright MCP headless sin sesiones en `127.0.0.1:8931`, con `--idle-timeout` de 10 min.
- `navegador-watchdog.timer` (`watchdog.py`, cada 5 min): cierra los daemons de `playwright-cli` que llevan 30 min sin actividad y mata renderers con más de 2,5 GB o más de 90 % de CPU durante 3 chequeos seguidos. Deja un registro en `~/.local/state/navegador/watchdog.log`.

Antes del 2026-10-24 era el contenedor `jlesage/chromium`. Su perfil queda como respaldo en `~/server-stack/chromium/config`.

## API (`src/server-browser.ts`)

- `GET /api/browser/status`: si responde el visor noVNC.
- `GET /api/browser/info`: estado, CPU y RAM de `navegador.service` y `playwright-agents-mcp.service`, pestañas (CDP `/json/list`), procesos conectados al 9222 y las últimas líneas del registro del watchdog.
- `POST /api/browser/open {url}`: abre una pestaña y la activa.
- `POST /api/browser/tabs/close {id}`: cierra una pestaña.
- `POST /api/browser/clients/disconnect {pid}`: hace `SIGTERM` a un proceso, solo si en ese momento está conectado al 9222.
- `POST /api/browser/restart {target: 'browser'|'agents'}`: reinicio ordenado del servicio.
- `POST /api/browser/cleanup`: corre el watchdog en el momento.

QA contra producción, de solo lectura: `bun run scripts/navegador-production-qa.ts`.
