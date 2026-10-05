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

Abrí **http://localhost:3457**. El usuario inicial es `admin`; la contraseña se genera al instalar y se guarda en un archivo privado:

```bash
cat "$HOME/.local/share/axon-install/initial-password.txt"
```

Cambiala desde Configuración y activá 2FA si lo necesitás. Cada instalación genera su propio secreto de sesión y empieza sin dominios ni proyectos ficticios.

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
axon update --ref v1.1.0 --wait
```

La actualización obtiene una revisión concreta de GitHub y construye la imagen **antes de detener la versión actual**. Durante el cambio hace una copia de los datos del panel con la aplicación detenida, conserva `.env` y comprueba que `/api/health` responda con la revisión nueva. El frontend y el backend salen de la misma imagen; no se monta `public/` por separado.

Si falla la construcción, la versión actual sigue funcionando. Si falla el arranque, intenta recuperar automáticamente la imagen anterior. Si la recuperación también falla, `status` muestra `recovery-required` con el error, sin indicar que el cambio terminó correctamente.

También podés volver a la versión anterior:

```bash
axon rollback --wait
```

Los datos siguen montados en la misma carpeta al actualizar o volver de versión. **Rollback cambia el código, no restaura una copia antigua de tus datos.** Para una migración de datos incompatible usá el respaldo y las instrucciones de esa publicación. El actualizador conserva imágenes, versiones y respaldos; no borra volúmenes, credenciales nativas ni aplicaciones del servidor.

Más detalles: [instalación, recuperación y migración](docs/installation.md).

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

## Licencia

[MIT](LICENSE).
