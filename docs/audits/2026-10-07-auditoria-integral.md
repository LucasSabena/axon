# Auditoría integral de AXON — 2026-10-07

Se recorrieron las 24 secciones de la aplicación en navegador, se ejecutaron las suites completas y se corrigieron contratos de autenticación, persistencia, recepción de solicitudes, uploads y ejecución de procesos. La auditoría partió de un checkout con trabajo concurrente: se conservaron esos cambios. Los hallazgos del informe del 6 de octubre no se contabilizan como nuevos hallazgos de esta corrida.

La recorrida integral se realizó con fixtures propias y no certifica ausencia de bugs en cada función. En la continuación se publicaron las correcciones y se comprobó la instancia real de lectura: ubicación y tamaño de backups, políticas y versiones conservadas, tooltip sobre consumo real y paridad de 436 archivos de runtime. Ver [backups y consumo](2026-10-07-backups-consumo.md). Borrado, instalación, formato y restauración de datos reales no se ejercitaron sobre el servidor del usuario.

## Continuación: backups y consumo

La suite final pasó con 309 tests en 51 archivos y 2644 assertions. Se agregó QA del progreso y de copias incompletas recuperables, así como 16 posiciones de tooltip. El paquete completo de correcciones está desplegado como `7cad571-audit-ea30a8399f4d`, con comprobaciones de lectura en producción y una imagen anterior conservada para rollback.

## Ajuste posterior: login en dos pasos

El login ahora solicita 2FA únicamente después de validar la contraseña de una cuenta que lo tenga activo. Una contraseña incorrecta no revela el estado de 2FA ni muestra el campo de código. La prueba de contraseña pendiente vence a los cinco minutos, es de uso único y se invalida al cambiar credenciales. El segundo paso admite TOTP y recuperación; no hay sesión de administrador hasta completarlo. Ver [verificación del flujo](2026-10-07-login-dos-pasos.md). La suite posterior pasó con 307 tests y la prueba real de navegador completó el login con un código de recuperación.

## Problemas confirmados y correcciones

| Prioridad | Problema y consecuencia | Corrección de raíz y evidencia |
|---|---|---|
| Alta | Las sesiones antiguas admitían representaciones alternativas del mismo token firmado. Eso permitía cambiar el hash usado para revocar un token sin invalidar su firma. | Verificación de una única representación base64, exactamente dos componentes, tipos y límites de claims; la comprobación de revocación está en el verificador compartido. Regresión con sufijos, saltos de línea y padding alternativo en `state-contracts.test.ts`. |
| Alta | La corrupción de configuración o del registro de sesiones podía tratarse como estado vacío/nuevo y perder credenciales o revocaciones. Las escrituras podían truncar archivos. | Sólo ENOENT representa instalación nueva. Estado inválido detiene la carga y preserva los archivos. Escritura privada exclusiva, fsync y rename atómico; las revocaciones se esperan antes de confirmarlas. Tests de reinicio, corrupción y errores de escritura. |
| Alta | Dos solicitudes simultáneas de primer arranque podían configurar administradores distintos; una interrupción entre guardar credenciales y consumir el token podía permitir reutilizarlo. | Serialización del setup completo; sello de consumo persistido con las credenciales y comprobado al reintentar. Tests de concurrencia, replay tras interrupción, reintento de escritura fallida y estado inválido. |
| Alta | Al fallar una escritura de contraseña/2FA, la memoria podía cambiar aunque el archivo conservara el valor anterior. Guardados simultáneos podían restaurar credenciales viejas. | Transacción serializada de auth que publica sólo después de la escritura durable, conserva otros campos ya guardados y mantiene identidad de auth para los guardados encolados. Reautenticación y logins con recuperación se serializan. Pruebas de fallo, actualización simultánea de ajustes, rotación de contraseña y recuperación única. |
| Alta | Comprobar el tamaño después de `json()`/`text()`/`formData()` no limita el consumo de memoria. Content-Length se puede omitir o falsificar. | Middleware antes de los parsers que cuenta bytes efectivamente leídos y cancela al superar el límite. Límites por tipo de endpoint; bloques binarios grandes conservan streaming. Tests con body fragmentado, cabecera falsa, interrupción y handler que no debe ejecutarse. |
| Alta | Un bloque de Biblioteca interrumpido podía dejar bytes parciales sin avanzar el offset confirmado. Reintentar añadía datos duplicados y corrompía el archivo. | Biblioteca reutiliza el escritor compartido con backpressure, rollback al último offset confirmado y comprobación de tamaño. Cancelación/finalización se revalidan bajo el bloqueo. Prueba con `abc`, interrupción de `de`, reintento `def` y resultado exacto `abcdef`. El test falló contra la versión anterior y pasó con la corrección. |
| Alta | El campo de login sólo admitía seis dígitos y truncaba/rechazaba códigos de recuperación de 2FA con letras y guion. | Campo que acepta TOTP y códigos completos de recuperación, con etiqueta correspondiente. Prueba de validez y conservación de `abcd-2345` en navegador. Backend real: enrolamiento TOTP, rechazo sin segundo factor, dos usos simultáneos del mismo código y exactamente un login exitoso. |
| Media | Cancelar un stream podía quedarse esperando indefinidamente la promesa de cancelación, reteniendo el escritor y el bloqueo de upload. También faltaba cubrir el final del proceso con el timeout. | Cancelación no bloqueante, terminación del proceso, drenaje temprano de stderr y timeout hasta el cierre. Tests con cancelación que nunca resuelve y lectura detenida. |
| Media | El timeout de procesos de host se aplicaba en el camino privilegiado pero no en desarrollo sin root. Matar sólo el wrapper deja hijos y pipes vivos. | Se aplica la misma envoltura `timeout` con grupo de procesos en ambos caminos; se liberan timers. Regresión real `sleep 2` con timeout 100 ms: antes devolvía éxito tardío, ahora código 124 y sin salida tardía. |
| Alta/Media | Consultas Docker de alertas sin límite podían congelar su loop. Una lectura SMART sin resultado concluyente podía borrar una alerta previa como si el disco se hubiera recuperado. | Uso del runner Docker acotado compartido; los resultados desconocidos conservan alertas anteriores. Revisado en código y ejercitado por la suite general; no se simuló una falla física real de disco. |
| Media | Programas declaraba tabla accesible aun al mostrar un estado vacío/fuentes sin filas; Compose tenía contraste insuficiente en tema claro; Historial carecía de nombre accesible en filtros y algunos enlaces dependían sólo del color. | Roles de tabla según contenido, contraste por tokens del tema, nombres accesibles y subrayado de enlaces. Fallos encontrados por Axe; las comprobaciones pasan después de corregirlos. |
| Media | TypeScript excluía todos los tests: el chequeo podía pasar aunque sus contratos fueran incorrectos. | Se corrigieron 12 errores de tipos: clientes HTTP inyectables expresan la firma de llamada sin exigir helpers propios de Bun, buffers de fixtures son BodyInit válido y probes usan su argumento real. Se eliminó la exclusión de tests. |
| Media | QA dependía de rutas de Playwright instaladas globalmente y de selectores antiguos; el boundary de fixture bloqueaba una consulta de estado necesaria. CI no ejecutaba todas las pruebas de agentes ni el recorrido integral. | Playwright como dependencia de desarrollo, Chromium reproducible, servidor propio con puerto libre y limpieza, marca de fixture obligatoria, scripts actualizados al wizard/dialog actual. `qa:full` reúne navegación, accesibilidad, responsive, login, auth, tokens, diagnóstico y backups; CI lo ejecuta y añade `test:agents`. |

## Resultado de verificaciones

| Verificación | Resultado local |
|---|---|
| Suite Bun inicial | 280 tests, 45 archivos, 0 fallos |
| Suite Bun final | 302 tests, 49 archivos, 2614 assertions, 0 fallos |
| Python de agentes | 38 tests, 0 fallos |
| Python de software | 12 tests, 0 fallos |
| Python de instalación/recuperación | 10 tests, 0 fallos |
| TypeScript | Aplicación, scripts TS y todos los tests incluidos: pasa |
| Sintaxis frontend / distribución | 104 archivos JS; 24 referencias import.meta y 15 copias de build verificadas |
| Sintaxis Python / bootstrap | 28 archivos Python; `bash -n install.sh`: pasan |
| Build | Pasa; bundle y assets actualizados |
| Dependencias de producción | `pnpm audit --prod`: 0 vulnerabilidades conocidas reportadas en esta corrida |
| Navegación | 30 checks: deep links, recarga, transición durante carga y recuperación; 0 excepciones/API errors |
| Matriz general de UI | 145 checks: 24 secciones, claro/oscuro, 320/390/768/1024 px, desktop 1440 px; 0 fallos, excepciones o errores de API |
| Login | 12 layouts claro/oscuro, ocho flujos; controles de teclado, movimiento reducido, loading, errores, TOTP/recuperación, login/logout real |
| Auth HTTP real | Ocho contratos: rotaciones simultáneas, revocación, sesión actual, nuevo password, enrolamiento TOTP, rechazo sin código, recuperación única y desactivación persistida |
| Plataforma | Cuatro grupos: diagnóstico persistente de proyecto, token/permisos/revocación, cuatro vistas responsive, error transitorio y reintento |
| Backups en navegador | Nueve grupos: wizard, Restic real, recarga, recuperación selectiva por bytes, edición/pausa, clave, reintento, alias y responsive/accesibilidad |
| PostgreSQL | Seis comprobaciones reales: inventario, pg_dump, Restic, importación temporal, datos exactos recuperados después de modificar el origen, origen preservado |

Las suites Python independientes y algunos contratos invocados desde Bun se solapan: no deben sumarse como un total de tests únicos. Axe cubre reglas automáticas de accesibilidad; no reemplaza una revisión manual completa con tecnologías de asistencia.

## Cobertura por sección

Todas las secciones siguientes pasaron deep link/recarga, revisión automática en ambos temas y geometría en cuatro anchos. La columna adicional identifica contratos ejercitados por las suites, no implica que todas las acciones de host de esa sección se hayan ejecutado en vivo.

| Sección | Ruta | Verificación adicional |
|---|---|---|
| Inicio | `/` | Navegación, enlaces/importación y assets |
| Puertos | `/puertos` | Resolución de rutas/host y validación de operaciones |
| Proyectos | `/proyectos` | Hub, diagnóstico persistente, permisos por proyecto |
| Docker | `/docker` | Runner acotado, inventario, integración Compose |
| Dominios | `/dominios` | Asociaciones dominio/puerto/proyecto |
| Archivos | `/archivos` | Crear/editar, uploads, transferencias, volúmenes, symlinks y rutas protegidas |
| Biblioteca | `/biblioteca` | Upload interrumpido y reintento, cache vivo, medios, rutas y transferencias |
| Terminal | `/terminal` | Inicialización de vista; WebSockets reales fuera del fixture |
| Navegador | `/navegador` | Inicialización/estado, contratos de seguridad; control remoto bloqueado en fixture |
| Programas | `/programas` | Inventario nativo, iconos, uploads, transacciones, estados vacíos accesibles |
| Tienda | `/tienda` | Catálogo y contratos del store; sin instalar software real |
| Drop | `/drop` | Carga y API general; sin exponer nuevos enlaces públicos de producción |
| Métricas | `/metricas` | Contabilidad de CPU/memoria y política del optimizador |
| Logs | `/logs` | Lectura/renderizado y conservación de errores de API |
| Salud | `/salud` | Diagnóstico y política de actividad; sin apagar servicios reales |
| Scripts | `/scripts` | Estado/renderizado; no ejecutar comandos de usuario reales |
| Almacenamiento | `/almacenamiento` | Planes, locks, protección de rutas, trash y recuperación en fixtures |
| Compose | `/compose` | Releases, borradores, dependencias, rollback y contraste |
| Agentes | `/agentes` | Cuentas, contexto, archivos, consumo y usage; 38 contratos Python |
| Configuración | `/configuracion` | Persistencia, auth, 2FA, password y validación de ajustes |
| Backups | `/backups`, `/respaldos` | Wizard completo, copia Restic y PostgreSQL, recuperación y origen preservado |
| Historial | `/historial` | Eventos, persistencia, filtros accesibles |
| Integraciones | `/integraciones` | Token real con permisos, revocación, OAuth/cloud con proveedores simulados |
| Escritorio | `/escritorio` | Contratos del backend/vista; sin inyectar eventos en la sesión física |

## Reproducir

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm run test
pnpm run test:agents
pnpm run test:software
pnpm run test:installer
pnpm run build
pnpm exec playwright install --with-deps chromium
pnpm run qa:full
pnpm run qa:platform:database
```

`qa:full` crea y limpia su propio servidor de fixture; no requiere reutilizar una instancia del administrador. Requiere las herramientas nativas usadas por AXON, incluyendo Restic. La prueba PostgreSQL requiere Docker y su imagen de PostgreSQL; usa contenedores y datos temporales, sin conexiones a bases del usuario. `AXON_QA_OUTPUT` cambia el directorio de evidencia. Para usar Chrome local ya instalado, se puede definir `AXON_QA_BROWSER_CHANNEL=chrome`; la corrida final también se verificó con Chromium de Playwright, como CI.

## Rendimiento y límites pendientes

Se midieron cinco cargas frías del login local y se guardaron recursos/tiempos en `2026-10-07/performance.json`. Esto es una medición del cliente en este equipo; no prueba capacidad, consumo sostenido ni comportamiento bajo múltiples usuarios. Los cambios de optimización de esta auditoría eliminan waits/procesos sin límite y evitan buffering de archivos binarios; no se atribuye una mejora porcentual sin comparar escenarios equivalentes.

Queda pendiente verificar en un entorno operativo dedicado: OAuth con cuentas reales de los proveedores, túneles/DNS/CDN externos, instaladores/actualizaciones de software real, terminal/WebSockets/noVNC interactivos, desconexiones físicas de discos y tiempos/capacidad bajo carga prolongada. Esas pruebas deben tener fixtures o servicios de prueba propios para no afectar este servidor.

`strict: false` conserva deuda de tipos heredada en partes del backend. Los tests ya participan en el chequeo, pero todavía no están activadas todas las reglas strict. Tampoco se midió cobertura de cada rama ni se hizo fuzzing exhaustivo.

La configuración de CI fue ampliada y los mismos comandos pasaron localmente; no se ejecutó una corrida remota de GitHub Actions ni se desplegaron estos cambios a producción desde esta auditoría.

## Evidencia

Los JSON principales están en `docs/audits/2026-10-07/`. Los logs, red/green, screenshots y archivos intermedios de esta sesión están en `/tmp/axon-audit-20261007/`; ese directorio es temporal. Los screenshots contienen datos de fixtures y lecturas del entorno, no se incluyeron masivamente en el repositorio.
