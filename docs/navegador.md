# Navegador del servidor

La pestaña **Navegador** muestra Google Chrome real corriendo en el host, con sesiones persistentes. Hay **dos** navegadores y los dos son visibles, para que nada de lo que hacen los agentes quede fuera de la pantalla:

| Visor | Pantalla | noVNC | CDP | Perfil | Para qué |
|---|---|---|---|---|---|
| **Servidor** | `:88` | `:5800` | `:9222` | `~/.config/navegador-chrome` | Sesiones reales (Google, Shopify, hosting). |
| **Agentes** | `:89` | `:5801` | `:9223` | `~/.config/playwright-agents` | Trabajo sin sesiones (QA, localhost, sitios públicos). |

## Qué se ve en la pestaña

- **Selector Servidor / Agentes**: cada uno tiene su pantalla virtual y su visor noVNC.
- **Barra de estado**: CPU y RAM del servicio elegido, cantidad de pestañas y agentes conectados por CDP.
  El CPU es la suma de **todos** los procesos del servicio (pestañas + GPU + red + Xvfb + VNC), así que puede pasar de 100 %: 224 % son 2,24 núcleos.
- **Tira de pestañas**: la que está al frente, la que acaba de navegar un agente (borde punteado), el % de JS de cada una y un botón para cerrarla. Un clic trae la pestaña al frente.
- **Seguir al agente** (activado por defecto): si un agente navega en una pestaña de fondo, AXON la trae al frente sola para que el visor muestre lo mismo que ve él.
- **Gestionar**: por pestaña, congelar/descongelar y cerrar; agentes conectados (con desconectar); reiniciar el navegador; registro de limpieza automática.
- **Vista en vivo**: en vez del visor noVNC, una captura de la pestaña cada ~2 s por HTTP (`/api/browser/screenshot`). No usa WebSocket, así que funciona en redes móviles que cortan el `Upgrade`; es nítida y liviana. Es de sólo lectura: para interactuar, «Controlar» (noVNC) o «Abrir aparte». Si el visor no conecta en ~12 s, AXON pasa solo a esta vista.

Congelar usa `Page.setWebLifecycleState`: la pestaña sigue abierta y con su estado, pero deja de correr. Es la forma de cortar el CPU de una página que quedó girando sin cerrarla ni perder lo que tenía.

## Qué hay en el host

Los archivos viven en `~/server-stack/navegador/` y corren como servicios `systemd --user`:

- `navegador.service` (`navegador.sh`): Xvfb `:88` + openbox + Chrome (perfil `navegador-chrome`) + x11vnc + websockify/noVNC en `127.0.0.1:5800`. CDP en `127.0.0.1:9222`. Con `KillMode=mixed`, el script cierra Chrome antes que la pantalla virtual: si Chrome muere sin guardar la cookie que Google acaba de rotar (`__Secure-1PSIDTS`), Google invalida la sesión. Chrome corre con `--disable-gpu`: sin eso emula una GPU por software y consume un núcleo entero aunque no haga nada.
- `navegador-agents.service`: el mismo `navegador.sh` con otras variables (`:89`, perfil `playwright-agents`, noVNC `5801`, CDP `9223`). Es el Chrome que usan los agentes para trabajar sin sesiones; antes era headless y no se podía ver.
- `playwright-navegador-mcp.service`: Playwright MCP en `127.0.0.1:8932` conectado por CDP al navegador del servidor.
- `playwright-agents-mcp.service`: Playwright MCP en `127.0.0.1:8931` conectado por CDP al navegador de agentes.
- `navegador-watchdog.timer` (`watchdog.py`, cada 5 min): cierra los daemons de `playwright-cli` que llevan 30 min sin actividad; mata pestañas con más de 2,5 GB o más de 80 % de CPU durante 2 chequeos seguidos; y si un Chromium de perfil temporal (`playwright_chromiumdev_profile-*`, el que levanta un script de test) se desboca, cierra el navegador entero. Deja un registro en `~/.local/state/navegador/watchdog.log`.

Los dos MCP arrancan con el shim `/home/binary/.local/share/pnpm/bin/playwright-mcp` y **sin** `--idle-timeout`: así el agente no pierde la pestaña en la que estaba trabajando cada 10 minutos. Antes apuntaban a un hash del store de pnpm que desaparece con cada update, y el servicio no volvía a arrancar.

Antes del 2026-10-24 era el contenedor `jlesage/chromium`. Su perfil queda como respaldo en `~/server-stack/chromium/config`.

## API (`src/server-browser.ts`)

- `GET /api/browser/status`: si responde cada visor noVNC (`available`, `agentsAvailable`).
- `GET /api/browser/info`: estado, CPU y RAM de los dos servicios, pestañas del servidor (`tabs`) y de agentes (`agentTabs`) con foco/JS/memoria, procesos conectados por CDP, modo seguir y las últimas líneas del registro del watchdog.
- `GET /api/browser/screenshot {which, id}`: JPEG de la pestaña (por defecto la que está al frente). Es la vista en vivo, sin WebSocket.
- `POST /api/browser/open {url, which}`: abre una pestaña y la activa.
- `POST /api/browser/tabs/close {id, which}`: cierra una pestaña.
- `POST /api/browser/tabs/activate {id, which}`: la trae al frente.
- `POST /api/browser/tabs/freeze {id, which, frozen}`: congela o descongela sin cerrar.
- `POST /api/browser/follow {which, on}`: prende o apaga el modo seguir al agente.
- `POST /api/browser/clients/disconnect {pid, which}`: hace `SIGTERM` a un proceso, solo si en ese momento está conectado al CDP.
- `POST /api/browser/restart {target: 'browser'|'agents'}`: reinicio ordenado del servicio.
- `POST /api/browser/cleanup`: corre el watchdog en el momento.

QA contra producción, de solo lectura: `bun run scripts/navegador-production-qa.ts`.
