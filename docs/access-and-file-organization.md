# Claves API y organización personal de archivos

La pantalla **Integraciones** permite crear y administrar claves para REST (`/api/v1`) y MCP (`/api/v1/mcp`). Cada clave conserva sus permisos explícitos por proyecto y por proveedor, ubicación, carpeta y acción de nube.

## Configuración y consumo

- Nombre, descripción, vencimiento y permisos editables.
- Pausa y reactivación sin reemplazar la clave; renovación del secreto conservando el identificador y el historial; revocación definitiva.
- Límites por minuto, ráfaga y concurrencia independientes para lectura, transferencia y operación. Los valores iniciales conservan los límites anteriores de AXON.
- Cupo diario opcional (`0` significa sin cupo). Se cuenta de forma persistente y se renueva a las 00:00 UTC. Las consultas autenticadas que superan el límite por minuto no consumen el cupo diario.
- Consumo por clave o total: solicitudes, errores HTTP y MCP, respuestas limitadas, bytes recibidos/enviados, tiempo medio, actividad por hora, rutas y últimas solicitudes. Períodos de 1, 7, 30 y 90 días, con exportación JSON.

El secreto se muestra sólo al crear o renovar una clave; la base guarda su hash. El registro de consumo no conserva cuerpos, parámetros de consulta ni credenciales. Las rutas usan plantillas, sin identificadores de recursos. Los datos empiezan a registrarse al instalar esta versión: no se reconstruye consumo anterior.

Los totales se conservan durante 90 días, por hora; el primer intervalo puede incluir hasta 59 minutos anteriores al comienzo del período seleccionado. Se mantienen las últimas 20.000 solicitudes entre todas las claves y se muestran hasta 50 por consulta. Los bytes recibidos se calculan desde `Content-Length`; los enviados se cuentan desde la respuesta, incluyendo streams completados o cancelados. La latencia de una descarga incluye su transferencia.

El cupo diario es atómico y persistente. La telemetría se escribe en lotes de hasta un segundo; un cierre abrupto puede perder el último lote de métricas, sin restablecer el cupo. La renovación invalida el secreto anterior inmediatamente y conserva el uso acumulado del día. Los límites internos no reemplazan los límites del proveedor de nube.

## Archivos y Biblioteca

Biblioteca vive dentro de Archivos (ver [el explorador unificado](archivos-explorador.md)); las dos vistas siguen compartiendo esta organización.

**Colores, etiquetas y marcas** está disponible para carpetas y archivos, individualmente o en una selección de hasta 200 elementos. Hay ocho colores, hasta 20 etiquetas y cuatro marcas independientes: Favorito, Me gusta, Guardado y Acceso rápido.

Las dos vistas comparten la organización de cada usuario. Los accesos rápidos pueden apuntar a carpetas o archivos. Se puede filtrar por tipo, color, etiqueta y marca. Las búsquedas incluyen etiquetas; Biblioteca muestra también carpetas conocidas por su índice, incluidas las vacías, y permite buscar sólo carpetas. La búsqueda recursiva de Archivos combina resultados del servidor y coincidencias de las etiquetas personales.

La edición múltiple permite agregar o quitar etiquetas conservando las restantes. La edición individual detecta cambios concurrentes y pide volver a abrir el formulario. Las vistas comparten actualizaciones y revisan cambios de otras sesiones.

La información se guarda en la base privada de AXON, sin modificar los bytes de los archivos. Las marcas locales están vinculadas a la ruta y a la identidad del disco: un disco distinto montado en la misma ruta no hereda la organización. Los movimientos verificados hechos por AXON trasladan las marcas de toda la carpeta; las copias no las duplican. Los favoritos antiguos de Biblioteca se incorporan una sola vez por usuario. Los archivos desconectados o ausentes conservan sus marcas, pero no aparecen como disponibles. Cambios externos de nombre o ubicación no trasladan las marcas automáticamente.

## Nube

Dropbox, Google Drive y OneDrive usan el mismo editor y los mismos filtros dentro de Archivos. Las marcas son personales, quedan en AXON y se vinculan a la cuenta conectada y a su ubicación. No se descargan archivos ni se cambian etiquetas o contenido en el proveedor para organizarlos. Las marcas de nube no se incorporan al índice local de Biblioteca.

## Verificación

`pnpm run test`, `pnpm run build` y `pnpm run check` verifican los contratos y la compilación. `scripts/organization-browser-qa.ts` prueba la navegación, persistencia, edición, consumo, renovación y límites en una instancia aislada con fixtures propias, tanto a 1440 como a 390 píxeles. La prueba visual de nube usa respuestas de proveedor simuladas; sus permisos e identidad se verifican por separado en `src/cloud/file-catalog.test.ts`.

Publicación del 8 de octubre de 2026: 329 pruebas aprobadas, compilación y comprobaciones correctas. Axe no detectó infracciones en el panel de claves ni en su editor móvil. La prueba de producción confirmó recarga de una sesión con recursos anteriores, consumo y bytes reales, pausa, renovación con continuidad del historial y revocación de una clave temporal, las vistas locales, el editor de carpetas y el listado de la cuenta de nube conectada. Se comprobaron anchos de 1440, 390 y 320 píxeles y coincidencia de 21 archivos de código e interfaz con el contenedor sano. No se modificaron archivos del usuario ni archivos de nube para esta prueba. Evidencias: `docs/qa/access-file-organization-2026-10-08/`. No se ejecutó CI remoto.
