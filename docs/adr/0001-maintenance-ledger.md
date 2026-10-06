# ADR 0001 — Mantenimiento durable, separado de los trabajos generales

Fecha: 2026-10-04. Estado: desplegada y verificada en el alias público el 4/10/2026.

## Problema

`jobs.ts` conserva la API de trabajos existente, con logs y persistencia al terminar de tipo best effort. Eso no garantiza una intención durable antes de mover o borrar datos. Los guards de navegación de Archivos tampoco constituyen una política para cleaners. El frontend y backend productivos se empaquetan juntos en la imagen; no se edita una interfaz montada en vivo.

## Decisión

- Mantener el monolito Bun/Hono y el frontend JavaScript/CSS. No incorporar servicios ni dependencias de infraestructura.
- SQLite de `bun:sqlite` bajo `<directorio de CONFIG_PATH>/maintenance/maintenance.sqlite`. Directorio 0700, base 0600, WAL, `synchronous=FULL`, transacciones `BEGIN IMMEDIATE` y migración explícita v1. Un esquema futuro no reconocido bloquea mantenimiento.
- Guardar análisis, planes, recibos de operaciones de archivos, locks, exclusiones, accesos, comparaciones y borradores como registros tipados. No migrar configuración ni bases personales.
- Un lock tiene recurso, operación e identidad del proceso: boot ID, PID y start time. No vence por reloj. Si el proceso desaparece, una operación con efectos queda interrumpida y el lock sigue vigente. Un scan de sólo lectura conserva su resultado interrumpido pero libera su lock después de comprobar que murió su proceso propietario; puede iniciarse otro análisis, sin reanudar el anterior. Una reconciliación del servicio de archivos comprueba el estado real antes de liberarlo.
- Los planes congelan selección, identidades, política, inventario, actor, sesión, caducidad y digest. Los planes de revisión de recursos del host no se convierten en ejecutables: `review-only` rechaza efectos incluso con digest válido. El executor real sólo habilita adapters con identidad, selección congelada, evidencia de actividad y permisos comprobados. El harness crea sus propias fixtures privadas.
- Mantener `jobs.ts` y sus consumidores sin cambiar estados ni contratos. Los recibos de mantenimiento se presentan en Almacenamiento y las operaciones verificadas de archivos se incorporan al feed. No inventar un job exitoso para representar un resultado incierto.

## Host y archivos

Los nuevos helpers reciben JSON por stdin y argv tipado; no reciben shell, flags ni comandos desde el navegador. `hostArgv` exige identidad no privilegiada explícita, valida que coincida con el usuario local o utiliza `nsenter` y `runuser`. Timeout y salida están acotados. El entorno del helper es mínimo; no contiene credenciales de Axon.

El scanner usa `open`/`stat` relativos a descriptores, `O_NOFOLLOW`, una sola exploración y límites de tiempo, entradas, profundidad y resultados. No lee contenido de archivos; sólo metadatos y los manifiestos de papelera conocidos. Excluye filesystems desconocidos, red/FUSE y especiales, y diferencia tmpfs del disco. Deduplica asignación por dispositivo/inodo. No estima espacio recuperable a partir de bytes lógicos.

`FileOperations` es el servicio compartido por Archivos, Biblioteca y Almacenamiento para papelera. El helper usa `renameat2(RENAME_NOREPLACE)`, ancla todos los ancestros sin seguir symlinks, conserva el symlink como objeto, hace fsync de metadata y directorios y usa un flock del usuario además del ledger. Guarda intención antes del movimiento, verifica identidad después, y conserva estado incierto si pierde la respuesta. La restauración no crea padres ni pisa archivos. El cambio de filesystem se rechaza: no hay fallback a copia/borrado. No hay borrado recursivo dentro del helper. La migración legacy → XDG congela la selección, actor/sesión, política, origen y fecha en un plan de cinco minutos. Persiste intención por paso, usa el mismo lock de papelera y no continúa el lote después de un resultado incierto. Reconciliar observa el paso interrumpido y libera el bloqueo sólo cuando determina su resultado; los elementos restantes requieren un nuevo plan. Los archivos llegados después del plan no se incluyen.

XDG: nuevos envíos a `~/.local/share/Trash/files` y `.trashinfo` en `info`, únicos y privados. La papelera legacy sigue legible/restaurable. Metadatos corruptos permanecen visibles. No se migra ni elimina su manifiesto en lote. Las referencias originales de Biblioteca se conservan y el índice se actualiza tras las operaciones verificadas.

## Límites deliberados

- La ruta XDG usa la ubicación convencional del home; overrides de XDG_DATA_HOME y papeleras de otros montajes todavía no se descubren. No afirmar cobertura de todos los dispositivos.
- Enviar/restaurar mediante rename atómico no libera espacio; sus recibos registran cero bytes retirados. La limpieza compatible verifica la selección y mide diferencia de espacio disponible por separado del tamaño retirado.
- APT, uv/pnpm, Snap/Devin no soportados, journal, OpenCode y backups conservan bloqueos específicos cuando faltan política, versión o alcance nativo demostrable.
- Copy/move usa ledger y worker durable; el cruce de filesystem conserva el original en cuarentena. Las sesiones de uploads existentes no sobreviven a un reinicio. No declarar Filebrowser reemplazado.
- Compose distingue borrador de aplicación. La aplicación soporta un contexto reconstruible; profiles, overrides y builds no recuperables permanecen bloqueados. No usa remove-orphans ni elimina volúmenes.

## Retención y capacidad

Se conservan hasta 50 análisis terminados o interrumpidos sin locks ni referencias de planes. Cada scan devuelve hasta 1.000 filas agregadas y procesa hasta 50.000 entradas durante 12 segundos. Las rutas paginan 50 filas. Los planes y recibos de recuperación no se borran automáticamente. Hasta 250 accesos y 20 borradores de hasta 256 KiB; no se crean respaldos de contenidos personales. Falta implementar retención opt-in de planes finalizados y backups existentes antes de uso prolongado.

## HTTP

Sesión autenticada, origen exacto, JSON limitado, campos permitidos, errores visibles y `private, no-store`. Para un reverse proxy HTTPS, configurar `AXON_PUBLIC_ORIGIN` con el origen público exacto. No confiar por defecto en headers forwarded arbitrarios. El cliente no recibe identidades completas del scanner ni de la papelera, ni tokens de sesión ni contenido de inspect/env.

## Evidencia

Ver `src/storage/*.test.ts`, `src/file-operations.test.ts`, `src/maintenance.test.ts`, `docs/qa/maintenance-browser.json` y `docs/qa/maintenance-readonly.json`. Las pruebas de fixtures no son autorización para actuar sobre datos reales.

## Workers nativos y checkpoints

Transferencias, limpieza compatible y Compose persisten intención, fases y recibos privados en el host antes del efecto; usan workers independientes del proceso web y locks nativos. La API reconcilia después de un reinicio sin repetir la operación. La misma operación puede recuperar sus locks; otra operación queda bloqueada. Biblioteca debe actualizar referencias antes de liberar una transferencia verificada.

Compose conserva YAML original, configuración resuelta y referencias de imagen fijadas en un directorio privado. Aplica sólo servicios revisados, mantiene apagados y no elimina volúmenes. La retirada requiere evidencia de migración y un plan específico. Los checkpoints están limitados a 20, las transferencias nativas a 200; al alcanzar el límite se pide revisar/exportar, sin borrado silencioso. El editor usa CAS y publicación atómica; los uploads conservan su motor previo, cuya sesión es de proceso.
