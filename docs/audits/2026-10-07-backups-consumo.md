# Backups, tamaños de carpetas y consumo — 2026-10-07

Correcciones publicadas en https://ports.binaryserver.com.ar y comprobadas con una sesión de navegador autenticada de lectura. Revisión desplegada: `7cad571-audit-ea30a8399f4d`. Base Git: `7cad5710a888b58e35b9238efbe646ba54ec2889` con cambios locales de la auditoría; no se hizo commit/push ni se afirma una ejecución de CI remoto.

## Dónde está la copia real

Repositorio: `/mnt/DATOS/AXON-Backups/31bef742-bb01-4f23-9a54-a14293946d02`.

La medición recursiva del directorio AXON-Backups ocupó 29.624.348.672 bytes en disco (29,62 GB decimales; ~27,59 GiB). La API corregida devuelve 29.619.754.165 bytes de tamaño aparente y la interfaz redondea a **28 GB** usando unidades de 1024. La API anterior devolvía 155 bytes con HTTP 200.

El último trabajo de Proyectos, `5a153dff-ac29-4ceb-ad0c-e7b56314f187`, figura comprobado desde el 7 de octubre a las 04:09, hora argentina. Su resumen de captura registró 87.463.128.478 bytes y 1.082.185 archivos procesados. Una lectura independiente de Restic confirmó el snapshot `7034b217eb845c264765c479e9165993ca0c895b40a2240a060f2b95e8d76ca7`; `stats --mode restore-size` informó 75.230.299.522 bytes y 1.278.061 entradas. Son métricas distintas: este modo cuenta enlaces duros una sola vez y recorre también entradas de directorio, según [el código oficial de Restic](https://github.com/restic/restic/blob/master/cmd/restic/cmd_stats.go). No se sustituyen retrospectivamente los resúmenes históricos.

El espacio cifrado puede ser menor que el tamaño de los originales: Restic comparte bloques repetidos y admite compresión. Ver [formato de repositorios](https://restic.readthedocs.io/en/stable/100_references.html) y [manual de estadísticas](https://restic.readthedocs.io/en/stable/manual_rest.html#checking-integrity-and-consistency).

## Causas y correcciones

1. **Tamaño parcial presentado como total.** `du -sb ... 2>/dev/null | cut -f1` ocultaba los errores de permisos y devolvía éxito por el último comando del pipeline. Se ejecuta du directamente, con el acceso de lectura del panel, después de validar la ruta. Un fallo o salida inválida nunca se transforma en un subtotal exitoso. No se siguen symlinks internos. Archivos informa “Sin calcular” cuando no puede obtener el total y distingue tamaño de archivos del espacio ocupado en propiedades.
2. **Ubicación y actividad poco visibles.** Cada destino muestra su ruta exacta y un enlace a Archivos. Hacer copia ahora informa la solicitud inmediatamente, abre el trabajo y conserva plan/job en la URL al recargar. Se muestran etapas, fechas y progreso de bytes/archivos; copiar y comprobar son etapas distintas.
3. **Progreso descartado.** El worker antes almacenaba stdout completo y leía sólo el resumen al terminar. Ahora procesa las líneas JSON durante la copia, guarda contadores acotados y limita las actualizaciones a 1/s. Mantiene el límite de ejecución, mata y recoge el proceso al excederlo. El polling actualiza los contadores sin reconstruir los controles: una regresión confirma que conserva el foco de teclado mientras avanza la copia. Contrato basado en [JSON de Restic](https://restic.readthedocs.io/en/latest/075_scripting.html).
4. **Copia incompleta convertida en éxito.** El exit code 3 conservaba un snapshot, pero la advertencia desaparecía al terminar. Ahora queda `failed/partial` con “Copia incompleta”: los datos guardados se verifican y pueden recuperarse; ese trabajo no ejecuta retención. Volver a comprobar la versión no borra la advertencia ni la convierte en copia completa.
5. **Tooltip desplazado o fuera de pantalla.** La posición fija dentro de un ancestro transformado tomaba un origen incorrecto. Se usa un único elemento en body, a 10 px del puntero, que pasa a izquierda/arriba cuando falta espacio y respeta un margen de 8 px. Se oculta al navegar, desplazar, redimensionar o pulsar Escape, sin acumular listeners por montaje.

## Evidencia

- Suite completa: **309 tests en 51 archivos, 2644 assertions, cero fallos**.
- Worker Python: tres regresiones sobre progreso antes de finalizar, timeout y snapshot real simulado como parcial, recuperado por bytes y vuelto a comprobar sin perder el estado incompleto.
- QA integral: 30 comprobaciones de navegación; 145 de las 24 secciones; nueve flujos de login, diez contratos HTTP de auth y cuatro grupos de plataforma; once grupos de backups y 16 posiciones de tooltip en 1440/768/390/320 px. Sin excepciones de navegador ni errores de API inesperados.
- Backups: Restic real en carpetas temporales propias, recuperación selectiva comparada con el original, persistencia al recargar, progreso por polling, aviso de copia incompleta, ubicación, claro/oscuro y WCAG A/AA.
- `pnpm run check`, `pnpm run build` y `git diff --check` aprobados.
- Producción: contenedor saludable, revisión esperada, **436 archivos de runtime iguales al checkout**. Dockerfile es un insumo de build excluido del contenido de runtime por `.dockerignore`.
- Sesión ya abierta antes de la última publicación: al recargar recibió el nuevo hash de backups.js y conservó el acceso.
- En la URL real: ubicación visible en escritorio/móvil, carpeta DATOS muestra 28 GB, hover real sobre la última barra cerca del mouse y dentro del viewport, ocultación al navegar, cero excepciones. Se conservaron los 14 jobs. No se crearon, cancelaron, recuperaron ni eliminaron backups reales durante esta comprobación.

Evidencias JSON en [backups-consumo](2026-10-07/backups-consumo/). La imagen anterior se conservó como `axon-audit-rollback:20261007-25011a4e3cfa` para rollback. Los screenshots y logs detallados quedan en `/tmp/axon-audit-20261007/`.

Las pruebas no certifican ausencia de bugs en cada función. Los estados históricos que perdieron su advertencia de exit code 3 no permiten demostrar retrospectivamente que todos los archivos de origen eran legibles. La política nueva evita esa ambigüedad en trabajos futuros. La prueba de producción leyó el snapshot; las recuperaciones completas se ejercitaron en fixtures, sin restaurar 75 GB sobre el servidor real.
