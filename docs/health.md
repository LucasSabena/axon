# Salud

`/salud` tiene cinco pestañas. Todo lo que borra o cambia algo pasa por reglas fijas en el servidor: el navegador nunca envía comandos ni rutas a borrar.

## Resumen

Disco libre, cuánto creció en 24 h, CPU, memoria, presión (PSI) y temperatura, más recomendaciones. **Optimizar ahora** ejecuta sólo las reglas *Seguras* y baja la prioridad de las tareas pesadas de fondo.

"Lo que más creció" compara dos fotos de tamaños de carpetas (`du`, cada 6 h, a prioridad mínima de CPU y disco). La primera foto tarda unos minutos tras el primer arranque.

## Limpieza (`src/health-rules.ts`)

Mismo enfoque que BleachBit: cada limpiador es una regla con *medir*, *limpiar* y una condición *en uso* que la omite si el programa está corriendo.

| Riesgo | Significado | Ejemplos |
|---|---|---|
| Seguro | No molesta a nadie. Entra en Optimizar y en la limpieza automática. | `/tmp` con más de 2 días, journal a 200 MB, logs rotados, APT, `-wal` de SQLite |
| Se regenera | El programa lo vuelve a bajar o crear. Sólo manual. | cachés de npm/pnpm/uv/pip/bun/cargo, `~/.cache/*` (≥ 50 MB), cachés de navegadores, Docker build |
| Revisar antes | Borra datos tuyos; pide confirmación y el servidor la exige. | papeleras, imágenes y contenedores de Docker |

Reglas de seguridad: rutas fijas en el código (las dinámicas — `~/.cache/<nombre>` y `*-wal` — se validan contra una lista y un patrón); nada de `rm` fuera de `$HOME`, `/tmp`, `/var/tmp`, `/var/log` o `/var/crash`; todo corre con `ionice -c3 nice -n19`; los navegadores en uso bloquean su caché.

La **limpieza automática** (opcional, 1 vez por día) sólo corre reglas *Seguras*.

## Espacio

Explorador estilo `ncdu`: tamaño de cada carpeta, entrar con un clic y **enviar a la papelera** (`gio trash`, recuperable). Se bloquean `~/.ssh`, `~/.gnupg`, los llaveros y todo lo que no sea tu carpeta personal o discos montados.

## Rendimiento (`src/health-host.py`)

- CPU por núcleo, memoria, swap y presión (`/proc/pressure`), que es lo que realmente indica si "está lento".
- Procesos agrupados por programa. Acciones: **bajar prioridad** (sólo sube el valor *nice* y pone E/S en clase idle) y **cerrar** (SIGTERM). Cada acción verifica `pid + starttime` para no tocar un proceso reciclado.
- Se protegen: procesos de otros usuarios, kernel, `systemd`, `sshd`, `docker`, `cloudflared`, el propio AXON, etc.
- **Prioridad automática** (estilo `ananicy`): cada 30 s baja la prioridad de ffmpeg, compiladores, compresores, whisper e indexadores. Se pueden agregar reglas por texto del comando. Nunca cierra nada.
- *Posiblemente olvidados*: servidores de desarrollo con más de 6 h y sin actividad. Sólo sugiere.
- Debajo queda el panel de contenedores de Docker (`optimizer.js`).

## Sistema

Las tarjetas anteriores: unidades fallidas, SSH, actualizaciones, certificados, Wake-on-LAN y apagado programado.

## API

`GET /api/health/overview` · `GET /api/health/cleanup[?refresh=1]` · `POST /api/health/cleanup/run` · `POST /api/health/optimize` · `GET /api/health/space?path=` · `POST /api/health/space/trash` · `GET /api/health/processes` · `POST /api/health/process/{renice,close}` · `PUT /api/health/settings`

Estado en `data/health.json` (historial 14 días, últimas 40 limpiezas, ajustes).
