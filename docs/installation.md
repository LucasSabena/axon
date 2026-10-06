# Instalación y actualizaciones

La instalación administrada mantiene separados el código y los datos:

```text
~/.local/share/axon-install/
  axon                  # comando estable
  manager.py            # instalador/actualizador
  installation.json     # revisión activa, anterior y estado
  .env                  # secreto de sesión y variables privadas
  data/                 # configuración y datos persistentes del panel
  repository.git/       # caché Git del repositorio público
  releases/<revision>/  # código de cada revisión
  compose.json          # despliegue activo
  backups/<fecha>/      # copia previa a cada cambio
  update.log            # registro de la actualización en segundo plano
  initial-password.txt  # contraseña generada para una instalación nueva
```

Con `--root` cambia la carpeta base; las demás rutas siguen relativas a ella. El acceso a Docker es un requisito. No se necesita Node, Bun o pnpm instalados en el host para instalar el panel: la construcción ocurre en Docker. Algunas herramientas del panel requieren sus dependencias propias en el host.

## Transacción de actualización

1. Bloquea actualizaciones concurrentes para esa instalación y valida la propiedad del contenedor.
2. Obtiene la rama, tag o revisión indicada, resuelve el commit y prepara su código.
3. Construye una imagen identificada por ese commit. La versión anterior sigue atendiendo durante esta etapa.
4. Valida el Compose nuevo. Detiene únicamente AXON durante la copia de datos; los demás contenedores siguen funcionando.
5. Copia los datos con un contenedor aislado de la imagen anterior, sin red y con un montaje de lectura. Así puede respaldar archivos creados por root y bases SQLite detenidas sin cambiar sus permisos.
6. Arranca la nueva imagen y espera su healthcheck. Verifica también la revisión que responde por HTTP.
7. Registra la versión activa y la anterior. Si falla el arranque, intenta recrear la anterior.

La construcción puede tardar varios minutos la primera vez. El servicio tiene una pausa durante el respaldo y la recreación; no se promete actualización sin interrupción. El rollback automático conserva los datos actuales. Antes de cambios incompatibles de esquema debe publicarse una migración y una estrategia de recuperación específica.

## Recuperar

```bash
axon status
tail -n 100 ~/.local/share/axon-install/update.log
axon rollback --wait
```

Si `status` indica `recovery-required`, revisá el error y los logs:

```bash
docker compose -f ~/.local/share/axon-install/compose.json logs --tail 100
```

Para iniciar manualmente el Compose conservado, indicá también el proyecto que aparece en las etiquetas del contenedor (`com.docker.compose.project`). El CLI usa un proyecto propio derivado de la ruta de instalación; ejecutar Compose con otro proyecto puede causar conflictos de propiedad.

Cada respaldo contiene `data.tar`, `.env`, `installation.json` y `compose.json`. Tratá esa carpeta como privada: contiene tus credenciales del panel. La restauración de datos es manual y requiere detener el panel y decidir qué escrituras posteriores querés conservar. No extraigas una copia sobre un panel en ejecución.

Si falló la primera instalación, la carpeta queda conservada y el comando estable permite reintentar con:

```bash
~/.local/share/axon-install/axon update --wait
```

No se hace limpieza automática de imágenes, versiones ni respaldos. El volumen de datos es un bind mount persistente de tu propia carpeta. Los perfiles e historiales de agentes siguen en el home original y no se copian ni se eliminan al actualizar el panel.

## Instalaciones anteriores

El instalador no adopta automáticamente un contenedor llamado `axon`. El nombre predeterminado nuevo es `axon-managed` y su etiqueta `io.axon.installation` identifica qué CLI puede administrarlo. Si el nombre está ocupado por otro despliegue, la instalación se rechaza antes de reemplazarlo.

La migración desde Compose requiere `--existing-data` y, si corresponde, `--env-file`, `--origin` y `--cloudflared-config`. Detené primero la instancia anterior para que la copia sea consistente. La copia se realiza en un contenedor aislado, con el origen montado en lectura, para conservar también archivos privados creados por root sin cambiar sus permisos. El origen debe coincidir con la URL del navegador para que funcionen las operaciones protegidas contra solicitudes de otro sitio.

Las autorizaciones específicas del optimizador pertenecen a `data/optimizer-audited-databases.json`, no al repositorio. Una instalación nueva no autoriza ninguna base de datos. Si migrás una instalación con autorizaciones previamente revisadas, copiá ese archivo junto con sus datos; cambiar el ID, imagen, creación o puertos de un contenedor invalida la coincidencia.
