# Archivos en la nube para agentes SSH

AXON conserva las credenciales de Dropbox, Google Drive y OneDrive. Los agentes usan un token propio de AXON, con vencimiento, revocación y permisos por conexión, ubicación, carpeta y acción. Ocultar una conexión en Archivos sólo cambia su visibilidad: no revoca sus tokens. Desconectarla bloquea el acceso. Una cuenta distinta necesita nuevos tokens; volver a autorizar la misma cuenta mantiene sus permisos.

## Configuración

1. En Configuración → Conexiones, conectá la cuenta. Para subir a Dropbox, habilitá `files.content.write` en Permissions de [tu aplicación de Dropbox](https://www.dropbox.com/developers/apps), guardá con Submit y elegí **Habilitar subidas** en AXON. La conexión de lectura actual se conserva si cancelás o falla la autorización.
2. En **Integraciones → Crear token**, elegí lectura, subida o ambas. Podés dejar proyectos sin acceso. Una ruta vacía permite toda la ubicación; para limitar el acceso a una carpeta existente, abrila en Archivos y elegí **Copiar ruta para agentes**. Lectura y subida pueden tener carpetas distintas. Google Drive y OneDrive tienen lectura; las subidas de esta versión son para Dropbox.
3. Descargá `axon-cloud.py` desde Integraciones al usuario SSH que ejecuta los agentes. No requiere paquetes de Python. Para un nombre de comando estable, guardalo como `~/.local/bin/axon-cloud` y dale permiso de ejecución.

```bash
python3 /ruta/axon-cloud.py configure --url http://127.0.0.1:3457
```

Para agentes en el mismo servidor, usá la dirección local y el puerto de AXON que muestra Integraciones. Para otra máquina, usá la dirección HTTPS pública, por ejemplo `https://axon.example.com`. El cliente se identifica como `AxonCloud/1.1.0`; no usa el User-Agent genérico de urllib que el acceso público bloquea.

Pegá el token cuando lo pida; no se muestra ni se pasa como argumento. Se guarda en `~/.config/axon/agent.json`, con permisos 600 dentro de un directorio 700. No pongas esta configuración en un proyecto ni en Git. `AXON_URL` y `AXON_TOKEN` permiten usar credenciales suministradas por el entorno; `AXON_CONFIG` permite elegir otro archivo privado para distintos agentes o permisos.

## Cómo descubre AXON un agente

Conectarse no le enseña toda la aplicación ni concede acceso a toda la administración. La API expone operaciones concretas; el token decide cuáles puede ejecutar y sobre qué proyectos, conexiones y carpetas. Los permisos del usuario SSH siguen siendo independientes.

El MCP entrega instrucciones al iniciar y un catálogo de herramientas con descripción y esquema de parámetros mediante `tools/list`. La herramienta **`axon_capabilities`** devuelve el alcance del token, las herramientas, las rutas REST, los límites y el flujo sugerido. Está disponible para cualquier token válido. Para agentes que usan la API o terminal:

```bash
python3 /ruta/axon-cloud.py capabilities
```

También pueden consultar `GET /api/v1/capabilities` con su bearer. El catálogo se calcula con los permisos del token; no muestra operaciones de otros proyectos ni concede nuevos permisos. Las ubicaciones activas y el permiso del proveedor se consultan con `axon_cloud_connections`. El flujo es: descubrir → navegar → descargar lo necesario → trabajar localmente → subir el resultado → verificarlo.

Actualmente se exponen recursos y estado de proyectos, diagnóstico, logs, historial, respaldos configurados y las funciones de nube descritas abajo, según los permisos otorgados. La API de agentes todavía no expone administración de Docker, cambios de dominios/configuración, terminal arbitraria ni edición/borrado en la nube. Dar más permisos a una clave no crea endpoints que aún no existen.

## MCP local

La orden común para iniciar el servidor es:

```bash
python3 /ruta/axon-cloud.py mcp
```

El proceso habla JSON-RPC por stdin/stdout y lee la configuración privada del mismo usuario SSH. Añade herramientas para descargar al disco del agente y subir archivos locales. El contenido binario viaja por REST, no por el contexto del modelo.

Codex CLI:

```bash
codex mcp add axon -- python3 /ruta/axon-cloud.py mcp
```

Claude Code:

```bash
claude mcp add --scope user axon -- python3 /ruta/axon-cloud.py mcp
```

Clientes que usan `mcpServers`, como Cursor, pueden usar esta entrada, ajustando la ruta:

```json
{"mcpServers":{"axon":{"command":"python3","args":["/ruta/axon-cloud.py","mcp"]}}}
```

OpenCode usa esta entrada en su configuración, conservando las demás opciones existentes:

```json
{"mcp":{"axon":{"type":"local","command":["python3","/ruta/axon-cloud.py","mcp"],"enabled":true}}}
```

Para Devin y cualquier agente con terminal, también funcionan los comandos de abajo aunque no se haya registrado un MCP. No se modifican automáticamente las configuraciones de todos los clientes ni se afirma haber probado cada uno de ellos. Formatos verificados con [OpenCode](https://opencode.ai/docs/mcp-servers/) y [Cursor](https://prod.cursor.com/docs/mcp), y con la ayuda de Codex y Claude Code instalados en el servidor.

Herramientas: `axon_capabilities`, `axon_cloud_connections`, `axon_cloud_list`, `axon_cloud_metadata`, `axon_cloud_read_text`, `axon_cloud_upload_status`, `axon_cloud_download_file` y `axon_cloud_upload_file`. Se anuncian según los permisos. Las herramientas de proyecto ya existentes siguen disponibles para los tokens que las permiten.

## Terminal

```bash
python3 /ruta/axon-cloud.py connections
python3 /ruta/axon-cloud.py list dropbox '/Proyecto'
python3 /ruta/axon-cloud.py download dropbox '/Proyecto/original.mp4' '/disco/trabajo/original.mp4'
python3 /ruta/axon-cloud.py upload dropbox '/disco/trabajo/final.mp4' '/Proyecto/final.mp4'
python3 /ruta/axon-cloud.py status ID_DE_SUBIDA
python3 /ruta/axon-cloud.py upload dropbox '/disco/trabajo/final.mp4' '/Proyecto/final.mp4' --resume ID_DE_SUBIDA
python3 /ruta/axon-cloud.py cancel ID_DE_SUBIDA
```

La carpeta local y la carpeta remota de destino deben existir. Se descarga sólo el archivo elegido. Las descargas se verifican y publican con un nombre nuevo; una copia incompleta no ocupa el nombre final. No se reemplazan archivos existentes, ni en el disco ni en Dropbox. Para actualizar un resultado, elegí otro nombre/versionado.

Las subidas tienen bloques de 8 MiB, un máximo por archivo de 256 GiB y hasta tres sesiones activas por usuario. AXON mantiene los offsets y hashes en SQLite; las sesiones de Dropbox se guardan cifradas. El cliente puede reanudar con el ID que informa un error, y vuelve a calcular el hash del archivo completo antes de publicar. Si la respuesta de publicación se pierde, consultá `status`: AXON comprueba el destino por tamaño y content hash; no publica otra vez a ciegas. Si no se confirma, revisá el destino antes de iniciar otra subida. Las sesiones sin terminar expiran. Revocar un token bloquea nuevas solicitudes; una operación que Dropbox ya aceptó puede terminar.

En **Archivos → Dropbox**, “Subidas de agentes” muestra progreso, agente y destino. Las operaciones también quedan en **Historial**, sin claves ni contenido del archivo.

## API y MCP HTTP

### Ritmo y concurrencia

Los límites son por token y se separan por tipo de trabajo. REST y MCP comparten el cupo de la categoría correspondiente. Dos agentes con el mismo token comparten esos límites.

| Categoría | Ritmo sostenido | Ráfaga máxima | Solicitudes simultáneas |
| --- | --- | --- | --- |
| Lecturas, navegación, metadatos y descubrimiento MCP | 1.200/min | 300 | 8 |
| Descargas binarias y bloques de subida | 2.400/min | 120 | 3 |
| Inicio/finalización/cancelación de subidas, diagnósticos y respaldos | 120/min | 30 | 2 |

Los cupos se reponen continuamente. Una ráfaga agotada recibe `429`, `Retry-After` calculado y un cuerpo con `code: axon-api-limit`, `lane`, `reason` y `retryAfter`; no se impone una pausa fija de 60 segundos. La concurrencia llena indica esperar a que termine una solicitud y reintentar. Una descarga mantiene su puesto hasta terminar o cancelarse; los bloques deben enviarse secuencialmente por sesión. Lecturas y bloques no se restan del mismo cupo. Esto no cambia los límites que Dropbox, Google o Microsoft apliquen por su cuenta.

El cliente de terminal respeta `Retry-After`. Para recuperar los cambios del cliente descargable, reemplazá sólo `axon-cloud.py` por la versión nueva; se conserva la configuración privada y el token. La ampliación del servidor beneficia también a los clientes API existentes.

Autenticación: `Authorization: Bearer TOKEN_AXON`. No se acepta ese token en las rutas administradoras ni en terminales de AXON.

| Método | Ruta bajo `/api/v1` | Uso |
| --- | --- | --- |
| GET | `/capabilities` | Funciones, herramientas, rutas, permisos y límites del token |
| GET | `/cloud/connections` | Conexiones y permisos disponibles |
| GET | `/cloud/:provider/list?source=account&path=...&cursor=...` | Navegar y paginar |
| GET | `/cloud/:provider/metadata?source=account&path=...` | Tamaño, revisión, hash |
| GET | `/cloud/:provider/content?source=account&path=...&revision=...` | Descargar binario; admite Range |
| POST | `/cloud/dropbox/uploads` | `{source,path,size,requestId}`; UUID v4 permite identificar/reintentar el inicio |
| GET | `/cloud/uploads/:id` | Estado y comprobante de resultado |
| PUT | `/cloud/uploads/:id?offset=N` | Bloque binario `application/octet-stream` |
| POST | `/cloud/uploads/:id/finish` | `{hash}`; content hash completo de Dropbox |
| POST | `/cloud/uploads/:id/cancel` | `{}`; abandona una sesión aún sin publicar |
| POST | `/mcp` | MCP Streamable HTTP; navegación, texto y estado |

El endpoint MCP requiere Accept `application/json, text/event-stream`. Negocia las versiones 2025-03-26, 2025-06-18 y 2025-11-25. Para transferir archivos del disco del agente mediante herramientas MCP, usá el cliente local anterior. La API no acepta rutas arbitrarias del servidor como origen de una subida.

Las rutas de Google Drive y OneDrive contienen IDs, no nombres: usá los valores que devuelve AXON. Las restricciones de carpeta comprueban los padres reales de esos IDs. Los cursores están cifrados y vinculados al token, cuenta, ubicación y carpeta. Los errores del proveedor se traducen sin revelar sus credenciales.

Referencias de implementación: [Dropbox upload sessions](https://docs.dropboxapi.com/dropbox-api/api-reference/user-endpoints/files/upload-session-start), [Dropbox content hash](https://www.dropbox.com/developers/reference/content-hash), [MCP de Codex](https://developers.openai.com/codex/mcp/).
