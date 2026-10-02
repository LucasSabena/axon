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
      - /:/hostfs:ro                        # filesystem del host (read-only) para rutas reales
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
