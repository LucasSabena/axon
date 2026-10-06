# AXON

Panel web para administrar un servidor Linux: procesos, puertos, proyectos, Docker, archivos, biblioteca multimedia y agentes de IA. Desarrollado con Bun, Hono y JavaScript/CSS, con 20 temas y navegación adaptable a escritorio y celular.

[![Checks](https://github.com/LucasSabena/axon/actions/workflows/ci.yml/badge.svg)](https://github.com/LucasSabena/axon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Instalar

Necesitás **Linux**, **Docker Engine**, **Docker Compose 2.20 o posterior**, **Git** y **Python 3.10 o posterior**. El usuario que instala debe poder ejecutar Docker. El instalador no instala Docker ni cambia los servicios del sistema. Cloudflare es opcional.

```bash
curl -fsSL https://raw.githubusercontent.com/LucasSabena/axon/main/install.sh -o /tmp/axon-install.sh
bash /tmp/axon-install.sh
```

También podés revisar el código antes de ejecutarlo:

```bash
git clone https://github.com/LucasSabena/axon.git
cd axon
bash install.sh
```

Al terminar, el instalador imprime un **enlace de primer acceso** (`http://localhost:3457/?setup=…`, de un solo uso) que abre el asistente de bienvenida: creás tu usuario y contraseña, AXON te muestra lo que ya detectó en el servidor (Docker, proyectos, discos) y elegís el tema. Después, el inicio muestra una lista de "Primeros pasos" con atajos a detectar proyectos, conectar un dominio, crear el primer backup, activar 2FA y explorar la Tienda — desaparece sola cuando la completás.

También podés entrar directo con el usuario `admin` y la contraseña generada al instalar, guardada en un archivo privado:

```bash
cat "$HOME/.local/share/axon-install/initial-password.txt"
```

La cuenta es **local a tu servidor**: no hay recuperación por mail. Podés cambiarla desde Configuración → Seguridad (cierra las demás sesiones), activar 2FA en el mismo lugar, o restablecerla desde la terminal:

```bash
axon reset-password     # nueva contraseña + cierra todas las sesiones
axon reset-onboarding   # vuelve a mostrar el asistente y los primeros pasos
```

Cada instalación genera su propio secreto de sesión y empieza sin dominios ni proyectos ficticios.

El comando queda en `$HOME/.local/bin/axon`. Si esa carpeta no está en tu `PATH`, usá la ruta completa:

```bash
"$HOME/.local/bin/axon" status
```

AXON administra el host a través de Docker privilegiado, `nsenter`, el socket de Docker y un montaje de lectura del host. Tiene permisos de administración del servidor. La instalación escucha en **127.0.0.1** por defecto; accedé mediante un túnel SSH o configurá tu propio proxy con HTTPS.

```bash
# Desde tu computadora, para un AXON instalado en otro servidor:
ssh -L 3457:127.0.0.1:3457 usuario@servidor
# Luego abrí http://localhost:3457 en tu computadora.
```

Opciones del instalador:

```bash
bash install.sh --port 3458 --name axon-personal
bash install.sh --root "$HOME/Servicios/axon" --host-user tuusuario
# Con un proxy ya configurado para este origen:
bash install.sh --origin https://axon.example.com
# Para acceso directo por red local, si lo necesitás:
bash install.sh --bind 0.0.0.0 --origin http://servidor:3457
```

## Actualizar

Para instalaciones hechas con este instalador:

```bash
axon update
axon status
```

`update` corre en segundo plano y sigue aunque cierres la terminal o SSH. El estado y el registro permiten comprobar cuándo terminó:

```bash
tail -f "$HOME/.local/share/axon-install/update.log"
# O esperar desde la misma terminal:
axon update --wait
# Instalar una publicación concreta:
axon update --ref v1.2.0 --wait
```

La actualización obtiene una revisión concreta de GitHub y construye la imagen **antes de detener la versión actual**. Durante el cambio hace una copia de los datos del panel con la aplicación detenida, conserva `.env` y comprueba que `/api/health` responda con la revisión nueva. El frontend y el backend salen de la misma imagen; no se monta `public/` por separado.

Si falla la construcción, la versión actual sigue funcionando. Si falla el arranque, intenta recuperar automáticamente la imagen anterior. Si la recuperación también falla, `status` muestra `recovery-required` con el error, sin indicar que el cambio terminó correctamente.

También podés volver a la versión anterior:

```bash
axon rollback --wait
```

Los datos siguen montados en la misma carpeta al actualizar o volver de versión. **Rollback cambia el código, no restaura una copia antigua de tus datos.** Para una migración de datos incompatible usá el respaldo y las instrucciones de esa publicación. El actualizador conserva imágenes, versiones y respaldos; no borra volúmenes, credenciales nativas ni aplicaciones del servidor.

Más detalles: [instalación, recuperación y migración](docs/installation.md).

## Backups fáciles de configurar

La página **Backups** guía en cuatro pasos: qué proteger, en qué discos guardar, cada cuánto hacer la copia y revisar los ajustes. Podés elegir varias carpetas, los archivos de un disco, los ajustes de AXON o bases PostgreSQL, y guardar copias independientes en hasta cinco discos físicos diferentes del origen.

- Frecuencia manual o cada 1 a 365 días, con horario de Argentina y conservación de versiones configurable.
- Estado y última copia comprobada por destino. Si un disco está desconectado, espera y continúa con los disponibles.
- Recuperación de archivos o carpetas en una carpeta nueva, conservando los originales.
- Copias cifradas con Restic y descarga de la clave de recuperación para guardarla fuera del servidor.

El host necesita **Restic** y Python; el panel indica si falta Restic. [Preparar el servidor](docs/installation.md#dependencias-para-backups). Copiar los archivos de un disco no crea una imagen arrancable del sistema. [Guía y alcance de Backups](docs/backups-2026-10-06/README.md).

La [publicación 1.2.0](https://github.com/LucasSabena/axon/releases/tag/v1.2.0) incluye Backups, conexiones de almacenamiento en la nube, acceso para agentes por API/MCP, inventario de software e iconos, nuevo login y correcciones de navegación y caché. [Notas y actualización](docs/releases/v1.2.0.md).

## Si ya tenías AXON instalado con Compose

El comando nuevo administra únicamente sus propias instalaciones. No toma control de un contenedor existente ni modifica su Compose automáticamente.

Podés continuar con tu despliegue anterior, actualizando el repositorio y reconstruyendo la imagen. Conservá `.env`, `data/` y los montajes necesarios del host. Eliminá cualquier montaje separado de `public/` para evitar una interfaz de una versión y un backend de otra.

Para pasar al instalador nuevo, hacé primero un respaldo, detené **sólo AXON** desde tu Compose anterior y usá:

```bash
bash install.sh \
  --existing-data /ruta/axon-anterior/data \
  --env-file /ruta/axon-anterior/.env \
  --host-user tuusuario \
  --origin https://axon.example.com
```

Esto **copia** los datos originales a la instalación nueva y conserva el login. No borra el despliegue anterior; evitá ejecutar ambos paneles sobre el mismo servidor durante operaciones de administración. Si usás dominios gestionados por Cloudflare, agregá `--cloudflared-config /ruta/config.yml`. Las cuentas y los historiales nativos de agentes permanecen en el home de su usuario.

## Agentes: cuentas, cuotas y consumo

- Cuentas separadas y selector de cuenta activa para las herramientas compatibles. Codex puede aplicar la selección al servidor y a su conexión de escritorio, esperando a que terminen las tareas activas.
- Terminal con selección de texto, enlaces copiables y sesiones persistentes para conectar las cuentas.
- Cuotas disponibles por cuenta, ventanas de uso y próximos reinicios cuando el proveedor publica esos datos. Los errores o datos vencidos se muestran como tales.
- Consumo histórico con filtros **hoy, 7, 15, 30 días y todo**, además de proveedor, modelo y cuenta cuando existe atribución verificable.
- Desglose de input, output, lectura/escritura de caché y razonamiento. La estimación de API usa el catálogo público de [Models.dev](https://models.dev), actualizado automáticamente al consultar si pasaron 24 horas, y permite refrescarlo manualmente.
- Chats y memorias agrupados por proyecto, búsqueda, lectura de historiales nativos y edición de memorias con control de conflictos y respaldo.

Para cambiar cuentas de **Codex Desktop conectado por SSH**, el selector usa `websockets` en el Python del host. En una instalación nueva podés preparar esa dependencia, aislada del Python del sistema:

```bash
# Requiere python3-venv; ejecutar como el mismo usuario --host-user:
axon setup-agents
```

Luego conectá tus cuentas desde Agentes. El cambio de cuenta no convierte una sesión ya iniciada con un perfil explícito en otra cuenta. Los proveedores, versiones y planes difieren: una cuota no disponible no significa ilimitada y una herramienta instalada no implica una cuenta conectada. [Alcance de consumo y precios](docs/agents-usage.md).

## Qué incluye

- Salud del servidor, CPU, memoria, disco, procesos y diagnóstico de uso. Optimización con propuesta, revalidación y recuperación; los servicios desconocidos y las bases de datos empiezan protegidos.
- Puertos y procesos, proyectos de desarrollo, logs, terminal y programas del host.
- Docker, edición y despliegue de Compose con borradores y registro persistente de operaciones.
- Archivos: navegación, edición de texto, creación, transferencias, subidas por bloques y papelera recuperable.
- Biblioteca multimedia: colecciones, favoritos, visualización, compartir y herramientas de procesamiento según dependencias disponibles.
- Tienda de aplicaciones, mantenimiento, inventario, migraciones, enlaces y notificaciones.
- Temas, navegación por URL, búsqueda y autenticación con 2FA.

El panel no trae cuentas, API keys ni herramientas de IA preconectadas. Las acciones de instalación y administración se ejecutan en el servidor que aloja AXON, con el usuario configurado.

## Desarrollo

Requiere Bun y pnpm. Usá **pnpm** para gestionar paquetes.

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run test:installer
pnpm run build
```

Los tests de cuentas de escritorio requieren `websockets==15.0.1` en el Python de desarrollo. Los tests usan fixtures temporales y no necesitan cuentas reales. Para probar la interfaz con datos aislados:

```bash
pnpm run qa:serve
```

El servidor de QA usa un origen y secreto independientes y bloquea operaciones sobre el host real. Para ejecución propia, configurá un `SESSION_SECRET` nuevo y un `CONFIG_PATH` válido; el instalador se ocupa de generar ambos para producción.

La CI comprueba tipos, JavaScript, regresiones, construcción, instalador, recuperación y arranque de la imagen Docker con la revisión exacta. Actualmente la validación de instalación se realiza en Linux x86_64; no se declara soporte verificado para otras arquitecturas.

## Navegación y dashboard

**Salud → Diagnóstico y optimización** muestra CPU, memoria y disco del host, consumo por contenedor y programas fuera de Docker, funciones de las aplicaciones y conexiones conocidas. Registra los mayores consumidores cada 30 segundos, conserva hasta 24 horas y muestra las últimas 120 muestras. CPU, espera por disco y tiempo robado por el hipervisor se distinguen; la CPU de los contenedores se normaliza por los núcleos del host.

**Optimizar** permite apagar bases de datos locales previamente auditadas, después de al menos **2 minutos continuos sin conexiones ni actividad detectada**. Cuenta conexiones abiertas aunque estén esperando, consultas breves por TCP mediante contadores de red, escrituras en todas las bases, mantenimiento, replicación y transacciones preparadas. Las comprobaciones son sólo de lectura y se repiten justo antes de cada parada. Una señal de uso, un error o una interrupción de las muestras impiden apagarla y el registro explica el motivo. Una aplicación sin comprobación de uso confiable sigue encendida, incluso si se marca **Sólo cuando la uso**. Los servicios de acceso y autenticación quedan protegidos por defecto.

La autorización corresponde al ID completo, creación, imagen y puertos locales de las instancias auditadas; no se transfiere a contenedores nuevos con el mismo nombre. **Siempre encendida** permite excluir una base local. Cada parada se registra antes de actuar y ofrece **Volver a encender**; las aplicaciones omitidas nunca se inician al deshacer. PostgreSQL se apaga con SIGTERM y espera sin plazo de cierre forzado, para dejar terminar conexiones que aparezcan entre comprobación y señal. En ese caso puede rechazar conexiones nuevas mientras termina; una espera no se informa como parada o restauración confirmada.

La limpieza opcional se limita a caché de compilación de Docker sin uso desde hace siete días; nunca usa `system prune`, borra volúmenes ni vacía `/tmp` o la caché de RAM. La vista nueva sólo se habilita cuando el backend anuncia compatibilidad, para soportar el montaje separado de `public/`.

Los datos se guardan en `optimizer.json` y `optimizer-history.json`, junto a `config.json`. Las acciones requieren autenticación. Validación: `pnpm run test`, `pnpm run check`, `pnpm run build`; recorridos de navegador con `scripts/optimizer-browser-qa.js` contra `pnpm run qa:serve` (acciones operativas simuladas).

Cada sección tiene una URL propia: `/archivos`, `/biblioteca`, `/agentes`, `/configuracion`, etc. El inicio `/` muestra acciones rápidas, archivos abiertos en este navegador, modificaciones recientes de la biblioteca, cambios guardados de agentes y actividad del servidor. Los respaldos existentes se identifican como tales, sin inventar historial de ediciones.

Archivos y Biblioteca guardan carpeta o colección, búsqueda, orden, vista, selección, foco y scroll. Atrás/Adelante recuperan el estado de cada entrada del historial; recargar conserva la ubicación y los visores o editores abiertos. La última ubicación por sección se recuerda en este navegador. Los enlaces permiten abrir otra pestaña o copiar una ubicación. El editor avisa antes de abandonar cambios sin guardar.

**Archivos → Nuevo archivo** crea un archivo vacío en la carpeta actual con cualquier nombre y extensión, incluidos `.txt`, `.env`, `.env.local`, JSON y nombres sin extensión. También aparece en clic derecho sobre el espacio vacío o una carpeta, y tiene el atajo `Ctrl/⌘ Alt N`. Crear nunca reemplaza un nombre existente; el editor se abre automáticamente y revela los archivos ocultos recién creados. Guardar / `Ctrl/⌘ S` conserva la revisión previa de cambios. Para volver a editar extensiones desconocidas, usar clic derecho → Editar o Abrir como texto. Sólo se edita texto UTF-8 completo de hasta 512 KiB; binarios, otras codificaciones y lecturas truncadas quedan en solo lectura. Se preservan BOM UTF-8 y saltos CRLF. Las escrituras respetan los permisos del usuario del host; `.env` y sus variantes se crean con permisos `600`.

Flechas, Inicio/Fin, Enter y selección con Shift/Ctrl funcionan sobre los archivos. Archivos incluye la barra de ubicación (`Ctrl/⌘ Shift L`) y subir de carpeta (`Alt ↑`); Biblioteca permite buscar con `/`, escribir para saltar por nombre y usar Esc/←/→ en el visor. Cada sección tiene ayuda de atajos, y `Ctrl/⌘ K` abre la paleta global.

## Discos y transferencias

Archivos muestra los discos físicos y sus volúmenes desde el host: internos, USB y otros discos externos, con capacidad, espacio libre y estado. La lista se actualiza al abrir la sección, al volver a la ventana y cada 12 segundos mientras está visible. «Actualizar discos» consulta nuevamente el sistema. Un volumen montado abre su carpeta; uno externo sin montar permite «Montar». Los formatos sin un volumen navegable permanecen visibles.

El botón **Explorar discos** de la barra superior está disponible en todas las secciones. Inicio, Salud, Métricas, Almacenamiento, Proyectos, Agentes, Biblioteca, Compose, Drop y Backups muestran el mismo inventario. Los selectores de carpetas permiten recorrer cualquier disco montado, incluso en ubicaciones personalizadas; dos montajes del mismo volumen no duplican la capacidad.

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

### Tienda, apariencia y entregas

- **Programas** (`/programas`) descubre paquetes y herramientas desde los gestores nativos, con búsqueda por gestor/ámbito, logos de escritorio y AppStream, y planes de actualización por instalación. [Cobertura, configuración y límites](docs/software-inventory.md).
- **Tienda** (`/tienda`) conserva un catálogo de recomendaciones y búsqueda en Flathub, y muestra otras aplicaciones instaladas desde el mismo inventario. Las nuevas instalaciones usan el ámbito de sistema; las actualizaciones revisan el plan de su instalación concreta. La desinstalación requiere un executor específico y permanece bloqueada cuando no existe. DaVinci usa la descarga oficial del fabricante. Flatpak y Flathub se preparan desde la tienda; las aplicaciones gráficas necesitan el escritorio del host.
- **Configuración → Apariencia** tiene modo Claro / Oscuro / Sistema y 10 presets de cada modo. Cada preset define colores, fuentes locales, densidad, radios y sombras. Sistema recuerda ambos temas. Las preferencias son de cada navegador.
- **Biblioteca → Links** lista enlaces, archivos originales, vencimiento y actividad; permite editar, silenciar avisos y revocar. Las descargas cuentan inicios observados, no transferencias completadas; los visitantes usan identificadores anónimos y se retienen los últimos 100 eventos de cada link.
- **ENTREGAS** admite enlaces simbólicos relativos a archivos conocidos dentro de las raíces. No sigue enlaces a directorios. Los links compartidos guardan destinos reales y sobreviven a la regeneración de los accesos directos. Las carpetas vacías también aparecen.

### Verificación

`pnpm run check`, `pnpm run test` y `pnpm run build` verifican tipos, sintaxis y contratos. Los tests usan datos temporales; no se deben ejecutar dentro del servicio montado con `/hostfs`. Para verificar el runtime en una imagen aislada, montar un directorio temporal exclusivo como `/tmp` en un filesystem permitido.

`pnpm run qa:serve` inicia una instancia local en `127.0.0.1:3459`, con configuración y sesión independientes. Los recorridos de `scripts/polish-browser-qa.js` y `scripts/expanded-browser-qa.js` prueban navegador con operaciones de host simuladas. Los recorridos de QA de navegador localizan Playwright mediante `AXON_QA_PLAYWRIGHT_ENTRY`.

### Chats y memorias de agentes

Agents incluye **Chats** (historial local por proyecto, búsqueda gradual, selección y exportación Markdown) y **Memorias** (Engram y memorias Markdown locales, edición con respaldos y comprobación de revisión). Prueba visual local: `scripts/agent-context-browser-qa.js` sobre `pnpm run qa:serve`; las escrituras visuales usan fixtures.

**Agents → Limpiar residuales** permite selección múltiple, seleccionar todos los disponibles y una sola confirmación por lote. Cada agente residual tiene un acceso rápido junto a su fila. Conserva respaldos recuperables; archivar no libera espacio en disco.

## Almacenamiento y migraciones (2026-10-04)

Axon agrega `/almacenamiento` con análisis bajo demanda, limpieza seleccionada de fuentes compatibles, planes e historial SQLite; papelera compartida XDG/legacy; copia/movimiento durable y editor con revisión; accesos de Inicio e inventario físico. Compose separa borradores, revisión, aplicación y recuperación. Las migraciones exigen comparación y pruebas antes de una retirada explícita, conservando los datos.

Casos no soportados tienen bloqueos visibles. La ejecución durable de desinstalación de programas, paridad completa de Filebrowser/Portainer y retención nativa de todos los gestores siguen pendientes. [ADR 0001](docs/adr/0001-maintenance-ledger.md). Las mutaciones detrás del proxy requieren `AXON_PUBLIC_ORIGIN`. QA usa fixtures independientes.

## Rediseño Control claro (2026-10-05)

La interfaz conserva las secciones, la navegación y los contratos existentes. Web Awesome se integra como componentes web locales; `pnpm run build:ui` genera el bundle desde la dependencia bloqueada. La navegación se agrupa, el tema rápido pasa al sol/luna del encabezado y los temas completos siguen en Apariencia. Los estilos compartidos están en `public/design-system.css` y los tokens en `public/themes.js`.

Para los tests de filesystem dentro de una imagen aislada, usar un directorio temporal exclusivo montado como `/tmp` en un filesystem permitido y añadir tmux/python3-websockets sólo a ese entorno de prueba; no ejecutar tests sobre `/hostfs` productivo.

## Licencia

[MIT](LICENSE).
