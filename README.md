# AXON

> Panel visual para gestionar **puertos activos**, **programas instalados** (con actualización en un click), proyectos de desarrollo, contenedores Docker y subdominios de Cloudflare — todo desde una interfaz web.
>
> **Arquitectura:** la app corre en un contenedor Docker pero ejecuta todos los comandos del sistema **en el host** vía `nsenter` (nombrespaces mount+pid+net de PID 1) y lee el filesystem del host montado en `/hostfs` (read-only). Esto hace que vea y controle el sistema real: pnpm/npm/node del usuario, apt/snap del sistema, procesos y rutas reales.

[![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Bun](https://img.shields.io/badge/Bun-000?logo=bun&logoColor=white)](https://bun.sh/)
[![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://www.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 📸 Vista previa

```text
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ AXON         │  ⌘K Buscar…        CPU▁▂▅ RAM▃▅ DISK 69%  LOAD 0.9   ⚙  ⏻  │
│              │                                                              │
│ MONITOR      │  Puertos abiertos              [Todos][Proyectos][Servicios] │
│ ▸ Puertos 52 │                                                              │
│   Proyectos  │  ▾ web-sofi                      ASTRO      /home/u/Proyectos│
│   Docker  31 │     ⚡ :4322 ●  localhost:4322   100.x.x.x:4322   [Info][⏻] │
│   Dominios 22│                                                              │
│              │  🔒 sshd          SYSTEMD  localhost:22   100.x.x.x:22       │
│ SISTEMA      │  ⚙  DNS           SYSTEMD  localhost:53   ̶1̶0̶0̶.̶x̶.̶x̶.̶x̶:̶5̶3̶      │
│   Programas  │                                                              │
│   Config     │  (links de red tachados = el servicio solo bindea 127.0.0.1) │
│              │                                                              │
│ TEMA         │                                                              │
│ Linear/Net./ │                                                              │
│ Warp   admin │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

> **Click en cualquier fila** abre un modal con Info, Stats en tiempo real, Logs y variables de entorno.
>
> **Pestaña Proyectos**: detecta automáticamente proyectos en disco, los agrupa por carpeta, y permite iniciar/detener, ver logs, editar, agregar manualmente o eliminar del panel (sin borrar archivos).

---

## ✨ Características

- 🎨 **3 temas visuales** conmutables en runtime (Linear, Netdata, Warp) — completamente tokenizados con CSS custom properties: colores, tipografías, densidad y radios por tema.
- 🗂️ **Sidebar colapsable** con contadores vivos por sección y selector de tema.
- ⌨️ **Command palette** (`Ctrl/⌘+K`): navegar secciones, abrir puertos en localhost o IP de red, cerrar procesos, lanzar updates, cambiar de tema.
- 📈 **Sparklines** de CPU/RAM en vivo en la topbar.
- 🧩 **Detección de systemd**: procesos supervisados se etiquetan y el cierre ofrece "Detener servicio" en vez de un kill que respawnea.
- 🔌 **Puertos (core)**: todos los listeners TCP/UDP del host, clasificados en Proyecto / Servicio / Sistema. Cada puerto se tracea al **root del repo git** (no solo el cwd), con detección de framework (Next.js, Astro, Vite, React, Django, FastAPI, Go, Rust…), ruta real, usuario, RAM y uptime. Cierre con **preview** (árbol de procesos + puertos a liberar + advertencias), SIGTERM→SIGKILL, y protección de daemons del sistema (sshd, systemd, dockerd, BBDD…).
- 📦 **Programas**: registro de programas actualizables (apt, snap, pnpm globals, bun, uv, pipx, rustup, apps .deb como ChatGPT/Chrome/VS Code…). Cada botón ejecuta los comandos reales por pasos con **log en vivo** y errores explícitos (comando + exit code + stderr). Botón "Actualizar todo". Inventario completo: apps desktop (.desktop + íconos), snaps, paquetes apt.
- 🔍 **Descubrimiento automático** de proyectos en disco (monorepo-aware) con arranque/parada/logs ejecutándose en el host con el usuario real.
- 🌐 **Asignación de subdominios** personalizados en un clic, integrado con Cloudflare DNS y Cloudflare Tunnel.
- 📊 **Estadísticas del servidor** en vivo: CPU, RAM, disco y load average.
- 📦 **Docker** con dominios asignados, logs, stats y env vars.
- 🖱️ **Detalle por proyecto/contenedor**: comando, CWD, CPU, memoria, uptime, threads, logs y env.
- ✏️ **Edición de dominios** sin eliminar y recrear.
- 🔒 **Autenticación** por cookie segura con sesiones firmadas.
- 🛡️ **Sanitización** automática de variables sensibles (tokens, keys, passwords).
- 📥 **Importación** masiva de dominios existentes desde la configuración remota del túnel de Cloudflare.
- 📁 **Proyectos**: descubrimiento automático de proyectos en disco, agrupados por carpeta, con arranque/parada, logs vía polling HTTP, edición, agregado manual y eliminación del panel.
- 🔧 **Configuración editable** desde la UI.
- 🔗 **Links local y network** para cada servicio.
- 🌐 **Dominio genérico**: funciona con cualquier dominio mediante `BASE_DOMAIN`.
- 🤖 **Agents de IA**: detecta los agentes instalados (Codex, Claude Code, Devin, OpenCode, Gemini, Antigravity, OpenChamber, Cursor, Windsurf) y las skills compartidas (`~/.agents`). Vista master-detail con skills, MCP servers, plugins y cuentas de cada agente: activar/desactivar con el mecanismo nativo de cada uno (`enabled` en `config.toml`, `enabledPlugins`, prefijo `-`, parking a `_disabledMcpServers`, rename `SKILL.md.off`), borrar, agregar skills/MCPs nuevos (con propagación a otros agentes), login/logout y update vía jobs. Toda escritura deja backup `.axonbak`.
  - **Búsqueda global**: el input del rail filtra agentes y encuentra items en TODOS los agentes (salta al agente + pestaña + item resaltado).
  - **Matriz MCP×agente**: pseudo-vista que muestra qué MCP está activo en cada agente, con toggles por celda.
  - **Item drawer**: click en una fila → panel con config completa, archivo fuente y acciones.
  - **Health check**: los MCPs remotos (URL http) se pueden verificar con curl desde la fila o el drawer.
  - **Config visual**: pestaña Config con labels/descripciones estilo VS Code Settings (bool→toggle, textos→input, objetos gestionados en su pestaña), sección **Credenciales** que expone secrets anidados (`provider.x.apiKey`, headers de MCPs) enmascarados con reemplazo, y lista de **backups `.axonbak`** con restauración.
  - **Tab Doc**: el archivo de instrucciones global de cada agente (AGENTS.md, CLAUDE.md…) se ve/edita/crea desde su detalle.
  - **Documentos**: pseudo-vista que descubre AGENTS.md/CLAUDE.md/reglas globales y de proyecto (barrido de `~/Proyectos`, `~/server-stack` y proyectos registrados), agrupados por proyecto, con lectura renderizada y edición; además lista **proyectos sin doc** con botón "Crear AGENTS.md".
  - **⌘K**: comandos `Agente: <nombre>`, `Agents: matriz de MCPs` y `Agents: documentos` en la paleta.

---

## Navegación y dashboard

**Salud → Diagnóstico y optimización** muestra CPU, memoria y disco del host, consumo por contenedor y programas fuera de Docker, funciones de las aplicaciones y conexiones conocidas. Registra los mayores consumidores cada 30 segundos, conserva hasta 24 horas y muestra las últimas 120 muestras. CPU, espera por disco y tiempo robado por el hipervisor se distinguen; la CPU de los contenedores se normaliza por los núcleos del host.

**Optimizar** permite apagar las dos instancias locales auditadas de `demo-postgres` y `example-postgres`, después de al menos **2 minutos continuos sin conexiones ni actividad detectada**. Cuenta conexiones abiertas aunque estén esperando, consultas breves por TCP mediante contadores de red, escrituras en todas las bases, mantenimiento, replicación y transacciones preparadas. Las comprobaciones son sólo de lectura y se repiten justo antes de cada parada. Una señal de uso, un error o una interrupción de las muestras impiden apagarla y el registro explica el motivo. Una aplicación sin comprobación de uso confiable sigue encendida, incluso si se marca **Sólo cuando la uso**. Authentik, Linkwarden, accesos, autenticación y otras bases quedan protegidos.

La autorización corresponde al ID completo, creación, imagen y puertos locales de las instancias auditadas; no se transfiere a contenedores nuevos con el mismo nombre. **Siempre encendida** permite excluir una base local. Cada parada se registra antes de actuar y ofrece **Volver a encender**; las aplicaciones omitidas nunca se inician al deshacer. PostgreSQL se apaga con SIGTERM y espera sin plazo de cierre forzado, para dejar terminar conexiones que aparezcan entre comprobación y señal. En ese caso puede rechazar conexiones nuevas mientras termina; una espera no se informa como parada o restauración confirmada.

La limpieza opcional se limita a caché de compilación de Docker sin uso desde hace siete días; nunca usa `system prune`, borra volúmenes ni vacía `/tmp` o la caché de RAM. La vista nueva sólo se habilita cuando el backend anuncia compatibilidad, para soportar el montaje separado de `public/`.

Los datos se guardan en `optimizer.json` y `optimizer-history.json`, junto a `config.json`. Las acciones requieren autenticación. [Inventario y diagnóstico inicial](docs/inventario-servidor-2026-10-03.md). Validación: `pnpm run test`, `pnpm run check`, `pnpm run build`; recorridos de navegador con `scripts/optimizer-browser-qa.js` contra `pnpm run qa:serve` (acciones operativas simuladas). `pnpm exec bun --no-env-file run scripts/optimizer-activity-qa.ts` observa bases locales durante dos minutos y abre una transacción real de sólo lectura después de preparar la propuesta: verifica que se omita la base, con todas las órdenes de apagado/inicio/limpieza bloqueadas. No ejecutarlo mientras otra instancia de QA esté muestreando las mismas bases.

Cada sección tiene una URL propia: `/archivos`, `/biblioteca`, `/agentes`, `/configuracion`, etc. El inicio `/` muestra acciones rápidas, archivos abiertos en este navegador, modificaciones recientes de la biblioteca, cambios guardados de agentes y actividad del servidor. Los respaldos existentes se identifican como tales, sin inventar historial de ediciones.

Archivos y Biblioteca guardan carpeta o colección, búsqueda, orden, vista, selección, foco y scroll. Atrás/Adelante recuperan el estado de cada entrada del historial; recargar conserva la ubicación y los visores o editores abiertos. La última ubicación por sección se recuerda en este navegador. Los enlaces permiten abrir otra pestaña o copiar una ubicación. El editor avisa antes de abandonar cambios sin guardar.

**Archivos → Nuevo archivo** crea un archivo vacío en la carpeta actual con cualquier nombre y extensión, incluidos `.txt`, `.env`, `.env.local`, JSON y nombres sin extensión. También aparece en clic derecho sobre el espacio vacío o una carpeta, y tiene el atajo `Ctrl/⌘ Alt N`. Crear nunca reemplaza un nombre existente; el editor se abre automáticamente y revela los archivos ocultos recién creados. Guardar / `Ctrl/⌘ S` conserva la revisión previa de cambios. Para volver a editar extensiones desconocidas, usar clic derecho → Editar o Abrir como texto. Sólo se edita texto UTF-8 completo de hasta 512 KiB; binarios, otras codificaciones y lecturas truncadas quedan en solo lectura. Se preservan BOM UTF-8 y saltos CRLF. Las escrituras respetan los permisos del usuario del host; `.env` y sus variantes se crean con permisos `600`.

Flechas, Inicio/Fin, Enter y selección con Shift/Ctrl funcionan sobre los archivos. Archivos incluye la barra de ubicación (`Ctrl/⌘ Shift L`) y subir de carpeta (`Alt ↑`); Biblioteca permite buscar con `/`, escribir para saltar por nombre y usar Esc/←/→ en el visor. Cada sección tiene ayuda de atajos, y `Ctrl/⌘ K` abre la paleta global.

## Discos y transferencias

Archivos muestra los discos físicos y sus volúmenes desde el host: internos, USB y otros discos externos, con capacidad, espacio libre y estado. La lista se actualiza al abrir la sección, al volver a la ventana y cada 12 segundos mientras está visible. «Actualizar discos» consulta nuevamente el sistema. Un volumen montado abre su carpeta; uno externo sin montar permite «Montar». Los formatos sin un volumen navegable permanecen visibles.

El botón **Explorar discos** de la barra superior está disponible en todas las secciones. Inicio, Salud, Métricas, Almacenamiento, Proyectos, Agentes, Biblioteca, Compose, Drop y Respaldos muestran el mismo inventario. Los selectores de carpetas permiten recorrer cualquier disco montado, incluso en ubicaciones personalizadas; dos montajes del mismo volumen no duplican la capacidad.

Proyectos y los documentos de agentes se buscan también en discos montados, con límites de profundidad, tiempo y cantidad de entradas. Biblioteca conserva sus carpetas elegidas: **Configuración → Agregar carpeta de un disco** incorpora otra ubicación; no se indexan discos completos automáticamente. Compose permite abrir YAML de otro disco. Métricas permite elegir el disco del gráfico; el historial de cada volumen empieza con sus primeras muestras reales. Las memorias y conversaciones de agentes registrados usan sus ubicaciones nativas y admiten configuraciones en otros discos.

Las políticas de Respaldos permiten elegir un repositorio cifrado en otro disco. Las credenciales y los recibos permanecen en el estado privado del usuario; la recuperación conserva el repositorio del snapshot original y no reemplaza los archivos de trabajo. Es un destino local, no un respaldo externo al servidor.

Los montajes conocidos se recuerdan entre reinicios. Un disco desconectado bloquea operaciones sobre su antigua ruta y Biblioteca conserva su índice previo hasta que vuelva a estar disponible. Los análisis de Almacenamiento agregan los discos como ubicaciones de revisión, sin habilitar borrados adicionales.

Seleccioná archivos, pulsá **Copiar** o **Mover**, elegí el disco y la carpeta de destino y pulsá **Pegar acá**. También funcionan `Ctrl/⌘ C`, `Ctrl/⌘ X` y `Ctrl/⌘ V`. Las colisiones generan nombres de copia y nunca sobrescriben. Los movimientos fallidos conservan el portapapeles pendiente. El historial muestra progreso, cancelación y recuperación. Al mover entre filesystems se conserva un original oculto recuperable, que sigue ocupando espacio; la operación no promete liberarlo automáticamente.

En Docker, el montaje del host debe propagar nuevos montajes: `/:/hostfs:ro,rslave`. Cambiar esa opción requiere recrear AXON. El montaje explícito de discos externos usa un helper limitado a dispositivos detectados y formatos permitidos, en `/mnt/axon-disks/`; exFAT/FAT/NTFS reciben el UID/GID del usuario configurado. Las transferencias siguen ejecutándose como ese usuario y verifican tanto el contenido como la identidad del montaje antes de escribir. No se formatean discos ni se modifican permisos de sus archivos existentes. Después de reiniciar el servidor, un disco sin montaje puede montarse nuevamente desde la lista.

Si un disco conectado físicamente no aparece ni en `lsblk` ni en `lsusb`, revisar conexión, cable, puerto y alimentación: AXON sólo puede mostrar dispositivos reconocidos por Linux.

## Subidas de Archivos

Archivos sube por bloques de 8 MiB, sin un tope fijo para el tamaño total del archivo. Cada bloque se escribe directamente en el host; la memoria usada no crece con el tamaño del video. El disco debe tener espacio para el archivo nuevo completo, incluso al reemplazar uno existente.

Las subidas se preparan en una carpeta temporal junto al destino y se publican mediante un reemplazo atómico al completarse. Cancelar o fallar conserva el archivo anterior. Los bloques y la confirmación final toleran reintentos; las sesiones inactivas se limpian después de una hora. Una pestaña abierta con el cliente anterior debe recargarse.

Verificación: `pnpm run test` y `pnpm run build`.

## 🏗️ Arquitectura

```mermaid
flowchart TB
    subgraph Internet
        User[Navegador del usuario]
    end

    subgraph Cloudflare
        DNS[DNS CNAME<br/>*.tu-dominio.com]
        Tunnel[Cloudflare Tunnel]
    end

    subgraph Servidor
        PM[AXON<br/>Bun + Hono :3457]
        Cloudflared[cloudflared]
        DockerSock[/var/run/docker.sock]
        ProcFs[/proc]
        Config[(data/config.json)]
    end

    User -->|HTTPS| DNS
    DNS --> Tunnel
    Tunnel --> Cloudflared
    Cloudflared --> PM
    PM -->|ss /proc| ProcFs
    PM -->|docker ps| DockerSock
    PM -->|REST| Cloudflare
    PM --> Config
```

---

## 🚀 Instalación

### Requisitos

- [Docker](https://docs.docker.com/engine/install/) + Docker Compose
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) ya configurado
- Credenciales de Cloudflare con permisos para DNS del dominio

### 1. Clonar el repositorio

```bash
git clone https://github.com/LucasSabena/axon.git
cd axon
```

### 2. Crear el archivo de entorno

```bash
cp .env.example .env
```

Editá `.env` con tus valores:

```env
CLOUDFLARE_EMAIL=tu-email@example.com
CLOUDFLARE_API_KEY=tu-api-key-global
CLOUDFLARE_API_TOKEN=          # opcional si usás API Key
CLOUDFLARE_ZONE_ID=tu-zone-id
CLOUDFLARE_ACCOUNT_ID=tu-account-id
CLOUDFLARE_TUNNEL_ID=tu-tunnel-id

# Dominio base para subdominios (ej. example.com -> app.example.com)
BASE_DOMAIN=tu-dominio.com

SESSION_SECRET=una-clave-larga-y-aleatoria
```

> **Nota:** La API Key global de Cloudflare tiene más permisos que un token; AXON prioriza `CLOUDFLARE_EMAIL` + `CLOUDFLARE_API_KEY`.

### 3. Crear la configuración inicial

```bash
cp data/config.example.json data/config.json
```

La primera vez que iniciés sesión con el usuario por defecto (`admin` / `admin`) se generará el hash de la contraseña.

> Cambiá la contraseña por una segura desde el mismo archivo `data/config.json` o borrando el hash para que se regenere.

### 4. Levantar con Docker Compose

Usá este servicio como ejemplo dentro de tu `docker-compose.yml`:

```yaml
services:
  axon:
    build: ./axon
    container_name: axon
    restart: unless-stopped
    pid: host
    network_mode: host
    privileged: true
    env_file:
      - ./axon/.env
    environment:
      PORT: 3457
      CONFIG_PATH: /app/data/config.json
      CLOUDFLARED_CONFIG: /app/cloudflared-config.yml
      CLOUDFLARE_ZONE_ID: ${CLOUDFLARE_ZONE_ID}
      CLOUDFLARE_ACCOUNT_ID: ${CLOUDFLARE_ACCOUNT_ID}
      CLOUDFLARE_TUNNEL_ID: ${CLOUDFLARE_TUNNEL_ID}
      HOST_USER: tu-usuario-del-host        # usuario para comandos a nivel de usuario (pnpm, bun, systemctl --user)
      PROJECT_SCAN_DIRS: /home/tu-usuario/Proyectos
    volumes:
      - ./axon/data:/app/data
      - ./axon/public:/app/public:ro
      - ./cloudflared/config.yml:/app/cloudflared-config.yml
      - /var/run/docker.sock:/var/run/docker.sock
      - /:/hostfs:ro,rslave                 # filesystem del host (read-only) para rutas reales
```

```bash
docker compose up -d --build axon
```

### 5. Acceder

- Local: `http://localhost:3457`
- Público: agregá una entrada en tu Cloudflare Tunnel apuntando a `http://localhost:3457`
- Usuario por defecto: `admin` / `admin`

---

## 🔄 Actualización

```bash
cd axon
git pull origin main
cd ..
docker compose up -d --build axon
```

Tus dominios y configuración se guardan en `data/config.json`, que persiste fuera de la imagen.

---

## ⚙️ Configuración

### `data/config.json`

```json
{
  "auth": {
    "username": "admin",
    "passwordHash": "..."
  },
  "domains": [],
  "projects": [],
  "settings": {
    "scanIntervalMs": 5000,
    "protectedPids": [1, 2],
    "protectedPorts": [22, 80, 443, 9090, 9443],
    "ignoredPatterns": [],
    "scanDirs": ["/home/tu-usuario/Proyectos"],
    "hostUser": "tu-usuario-del-host"
  }
}
```

| Campo | Descripción |
|-------|-------------|
| `scanIntervalMs` | Frecuencia de refresco de la UI |
| `protectedPids` | PIDs que no se pueden matar |
| `protectedPorts` | Puertos que no se muestran como asignables |
| `ignoredPatterns` | Procesos a ocultar en la pestaña Desarrollo |

### Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `CLOUDFLARE_EMAIL` | Email de la cuenta Cloudflare (para API Key global) |
| `CLOUDFLARE_API_KEY` | API Key global de Cloudflare |
| `CLOUDFLARE_API_TOKEN` | API Token alternativo (no usado si hay API Key) |
| `CLOUDFLARE_ZONE_ID` | Zone ID del dominio en Cloudflare |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID de Cloudflare |
| `CLOUDFLARE_TUNNEL_ID` | Tunnel ID de Cloudflare |
| `BASE_DOMAIN` | Dominio base para subdominios (ej. `example.com`) |
| `SESSION_SECRET` | Clave para firmar cookies de sesión |

### Importar dominios existentes

Si ya tenés subdominios creados manualmente en Cloudflare, andá a la pestaña **Dominios** y usá el botón **Importar desde Cloudflare** (o llamá a `POST /api/domains/import`).

### Gestión de proyectos

La pestaña **Proyectos** descubre automáticamente directorios con `package.json` o `requirements.txt`, los agrupa por carpeta padre y permite:

- **Detectar** proyectos nuevos (`POST /api/projects/detect`).
- **Agregar** un proyecto manualmente.
- **Iniciar** un proyecto (`POST /api/projects/:id/start`).
- **Detener** un proyecto (`POST /api/projects/:id/stop`).
- Ver **logs en vivo** vía polling HTTP (`GET /api/projects/:id/logs?tail=N`).
- **Editar** o **eliminar** del panel (sin borrar archivos).
- Ver links **Local** (`http://localhost:<port>`) y **Network** (`http://<ip>:<port>`).

---

## 🔐 Seguridad

- Nunca commitees `data/config.json` ni `.env`.
- Las variables de entorno sensibles se ocultan automáticamente en la UI.
- El contenedor requiere `privileged: true`, `pid: host` y `network_mode: host` para poder leer `/proc`, usar `ss` y el socket de Docker.
- Ejecutá AXON solo en redes privadas de confianza.

---

## 🛣️ Roadmap

- [x] Soporte para editar configuración desde la UI.
- [x] Histórico de logs con polling HTTP.
- [x] Arrancar/parar proyectos desde el panel.
- [x] Proyectos agrupados por carpeta con detección, edición y eliminación.
- [ ] Soporte multi-usuario con roles.
- [ ] Tests automatizados.

---

## 📄 Licencia

MIT © Lucas Sabena

### Tienda, apariencia y entregas

- **Tienda** (`/tienda`) instala aplicaciones en el host para todos sus usuarios. Incluye 25 fichas y búsqueda en Flathub; instalación, actualización y desinstalación usan trabajos con progreso. DaVinci usa la descarga oficial del fabricante. Flatpak y Flathub se preparan desde la tienda; las aplicaciones gráficas necesitan el escritorio del host.
- **Configuración → Apariencia** tiene modo Claro / Oscuro / Sistema y 10 presets de cada modo. Cada preset define colores, fuentes locales, densidad, radios y sombras. Sistema recuerda ambos temas. Las preferencias son de cada navegador.
- **Biblioteca → Links** lista enlaces, archivos originales, vencimiento y actividad; permite editar, silenciar avisos y revocar. Las descargas cuentan inicios observados, no transferencias completadas; los visitantes usan identificadores anónimos y se retienen los últimos 100 eventos de cada link.
- **ENTREGAS** admite enlaces simbólicos relativos a archivos conocidos dentro de las raíces. No sigue enlaces a directorios. Los links compartidos guardan destinos reales y sobreviven a la regeneración de los accesos directos. Las carpetas vacías también aparecen.

El alcance implementado, mediciones, pruebas y siguientes mejoras están en [docs/mejoras-2026-10-03.md](docs/mejoras-2026-10-03.md).

### Verificación de las mejoras

`pnpm run check`, `pnpm run test` y `pnpm run build` verifican tipos, sintaxis y contratos. Los tests usan datos temporales; no se deben ejecutar dentro del servicio montado con `/hostfs`. Para verificar el runtime en una imagen aislada, ver los requisitos de fixtures y herramientas en el informe de Control claro al final de este documento.

`pnpm run qa:serve` inicia una instancia local en `127.0.0.1:3459`, con configuración y sesión independientes. Los recorridos de `scripts/polish-browser-qa.js` y `scripts/expanded-browser-qa.js` prueban navegador con operaciones de host simuladas. `scripts/library-links-qa.ts` prueba videos reales temporales y una copia intacta de `entregas.sh`, sin escribir en la producción audiovisual. Los scripts `production-*-smoke.ts` verifican origen / alias; el de links crea y revoca un enlace corto de QA y descarga su ZIP. No ejecutarlos indiscriminadamente sobre otro entorno.

Para desplegar usar **`axon-deploy`**, seguir `/tmp/axon-deploy.log` y verificar la URL pública. No ejecutar Compose inline desde herramientas de agentes.

### Chats y memorias de agentes

Agents incluye **Chats** (historial local por proyecto, búsqueda gradual, selección y exportación Markdown) y **Memorias** (Engram y memorias Markdown locales, edición con respaldos y comprobación de revisión). [Almacenes soportados, investigación, límites y validación](docs/chats-y-memorias-2026-10-04.md). Prueba visual local: `scripts/agent-context-browser-qa.js` sobre `pnpm run qa:serve`; las escrituras visuales usan fixtures y la integración real de Engram se verifica con datos aislados.

**Agents → Limpiar residuales** permite selección múltiple, seleccionar todos los disponibles y una sola confirmación por lote. Cada agente residual tiene un acceso rápido junto a su fila. Conserva respaldos recuperables; archivar no libera espacio en disco. [Flujo y validación](docs/limpieza-residuales-2026-10-04.md).

## Almacenamiento y migraciones (2026-10-04)

Axon agrega `/almacenamiento` con análisis bajo demanda, limpieza seleccionada de fuentes compatibles, planes e historial SQLite; papelera compartida XDG/legacy; copia/movimiento durable y editor con revisión; accesos de Inicio e inventario físico. Compose separa borradores, revisión, aplicación y recuperación. Las migraciones exigen comparación y pruebas antes de una retirada explícita, conservando los datos.

Casos no soportados tienen bloqueos visibles. La ejecución durable de desinstalación de programas, paridad completa de Filebrowser/Portainer y retención nativa de todos los gestores siguen pendientes. [Funciones, límites y evidencia](docs/maintenance-2026-10-04.md); [ADR 0001](docs/adr/0001-maintenance-ledger.md). Las mutaciones detrás del proxy requieren `AXON_PUBLIC_ORIGIN`. QA usa fixtures independientes.

## Rediseño Control claro (2026-10-05)

La interfaz usa la dirección A y conserva las veinte secciones, la navegación y los contratos existentes. Web Awesome se integra como componentes web locales; `pnpm run build:ui` genera el bundle desde la dependencia bloqueada. La navegación se agrupa, el tema rápido pasa al sol/luna del encabezado y los temas completos siguen en Apariencia. Los estilos compartidos están en `public/design-system.css` y los tokens en `public/themes.js`.

[Alcance, pruebas, mediciones públicas y reversión](docs/redesign-implementation-2026-10-05/README.md). Para los tests de filesystem dentro de una imagen aislada, usar un directorio temporal exclusivo montado como `/tmp` en un filesystem permitido y añadir tmux/python3-websockets sólo a ese entorno de prueba; no ejecutar tests sobre `/hostfs` productivo.
