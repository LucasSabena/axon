# Backups de AXON

Página principal `/backups`, con compatibilidad para los enlaces existentes de `/respaldos`. Se reutiliza el motor Restic y se reemplaza el formulario técnico por un asistente de cuatro pasos en el diseño Control claro de AXON.

## Uso

1. **Qué proteger:** una o varias carpetas, los archivos de un disco completo, los ajustes de AXON o una base PostgreSQL. Se elige desde el explorador de carpetas o los proyectos registrados.
2. **Dónde guardar:** uno a cinco discos físicos diferentes del origen. Cada destino contiene un repositorio independiente bajo `AXON-Backups/<id del backup>`. Los archivos existentes del destino se conservan.
3. **Cada cuánto:** ejecución manual o cada 1 a 365 días, con horario de Argentina. La interfaz ofrece frecuencias habituales y una cantidad personalizada. Las versiones se conservan durante el plazo elegido o sin límite.
4. **Revisar:** nombre, contenido, destinos, frecuencia y conservación en lenguaje simple. Guardar los ajustes no inicia un backup de todos los archivos del usuario; la primera copia se ejecuta manualmente o en el horario programado.

Cada destino muestra el estado de su copia y la fecha de la última versión comprobada. Es posible editar, pausar, reanudar, comprobar una versión, explorar sus archivos y recuperar todo o una selección. Las recuperaciones se guardan en una carpeta nueva de `~/AXON-Restauraciones`, conservando los originales.

**Clave de recuperación:** el botón descarga explícitamente un archivo privado con la contraseña de Restic y las ubicaciones de los repositorios. Guardarlo fuera del disco del sistema permite acceder a los repositorios después de perder el servidor. AXON no guarda esa descarga en el proyecto ni incluye la contraseña en el historial de auditoría.

## Contratos operativos

- Carpetas arbitrarias admitidas por la política de rutas del servidor; hasta 20 por backup. Los respaldos nuevos de carpetas incluyen archivos ocultos y compilaciones por defecto. Las exclusiones son optativas y visibles.
- Identidades de disco verificadas al elegir, guardar y ejecutar. Un disco diferente en la misma ruta no se acepta como el original. Los destinos con UUID pueden encontrarse después de un cambio de punto de montaje.
- Cola persistida por destino en SQLite, con una sola copia o recuperación en ejecución. Clics repetidos no duplican un intento pendiente. Las colas sobreviven a reinicios y no dependen de dejar el navegador abierto.
- Un destino desconectado queda pendiente y se revisa nuevamente cada minuto. Los destinos disponibles siguen trabajando. Un inicio sin confirmación conserva el intento; una comunicación interrumpida no habilita otro lanzamiento hasta conocer el estado anterior.
- La programación recupera horarios vencidos al volver a iniciar AXON, reúne los horarios omitidos en una copia y avanza sólo después de un resultado comprobado. Los errores de ejecución tienen una espera antes de reintentar. Pausar cancela trabajos todavía no lanzados y conserva las versiones.
- Las copias congelan su configuración y destino. Recuperar una versión anterior conserva su repositorio original aunque se hayan editado los ajustes. Una copia anterior en ejecución no modifica el próximo horario de una configuración nueva.
- Repositorios anclados con un descriptor de directorio y comprobación del montaje; no se crean respaldos en la carpeta vacía que queda al desconectar un disco. Los orígenes también se comprueban después de la captura.
- Restic verifica la recuperación. Si una segunda copia completa no entra en el disco del servidor, los respaldos de archivos se verifican leyendo y comprobando todos los datos cifrados y ejercitando la recuperación de un archivo sin llenar ese disco.
- La conservación usa `restic forget` sobre IDs concretos de versiones antiguas del mismo backup que tienen un recibo de comprobación. Sólo se ejecuta después de comprobar una copia nueva; se conserva la última versión. `restic prune` libera datos sin referencias mediante la herramienta oficial. Nunca se borran manualmente archivos internos de Restic.
- Las carpetas de backups, las recuperaciones y otros discos montados dentro del origen se excluyen de la captura. Así se evita respaldar repositorios recíprocamente y hacer crecer las copias indefinidamente.
- Se conservan las políticas y los recibos anteriores; las APIs por proyecto y los enlaces viejos siguen siendo compatibles. La revisión de movimientos de Archivos contempla todos los orígenes y destinos del backup.
- Assets con versión derivada de contenido y HTML de rutas sin caché, utilizando el proceso de compilación existente.

## Alcance y límites

“Archivos de un disco” es una copia de archivos del filesystem seleccionado, **no una imagen arrancable ni una recuperación automática del sistema operativo**. Excluye otros montajes y árboles temporales o virtuales del sistema. Las bases en uso deben usar el backup PostgreSQL, que captura un dump y verifica su importación en un contenedor temporal. La copia de ajustes conserva el alcance existente de AXON; no equivale a respaldar todas las aplicaciones del servidor.

No se implementó una sincronización bidireccional ni una copia espejo de archivos sueltos: la copia se cifra y se recupera desde esta página. La recuperación completa necesita espacio suficiente en el home del servidor; se puede recuperar sólo lo necesario. El archivo de la clave permite recuperación con Restic después de una reinstalación; todavía no hay un asistente de importación de repositorios externos en una instalación nueva.

Un disco externo conectado al mismo servidor no constituye una copia fuera del sitio. La página explica este alcance sin presentar las copias como protección total.

## Diseño y referencias

- [Duplicati: configuración por etapas](https://docs.duplicati.com/getting-started/set-up-a-backup-in-the-ui): separación de contenido, destino, programación y conservación, con revisión antes de guardar.
- [Apple Time Machine](https://support.apple.com/en-euro/guide/mac-help/mh35860/mac): claridad al elegir un disco y al recuperar archivos de una fecha.
- [Kopia: snapshots y políticas](https://kopia.io/docs/getting-started/): diferenciación entre el contenido, el repositorio y la frecuencia.
- [21st Configuration Stepper](https://21st.dev/@shadcnspace/components/stepper-02) y [Origin UI Stepper](https://21st.dev/@originui/components/stepper): jerarquía de pasos y progreso. Se utilizaron como inspiración; la implementación reutiliza los componentes, Lucide, tokens y pila vanilla de AXON, sin importar React.
- [Restic: conservación de versiones](https://restic.readthedocs.io/en/stable/060_forget.html): operaciones nativas sobre snapshots, conservando datos referenciados.

La búsqueda adicional en Lazyweb tuvo cobertura débil para backups; no se usó como evidencia funcional.

## Validación local

- `pnpm run check`: TypeScript y sintaxis del frontend.
- `pnpm run build`: assets y servidor compilados.
- `pnpm run test`: suite completa de la publicación, 280 pruebas aprobadas (2543 aserciones).
- `src/platform/backup-plans.test.ts`: calendario de Argentina, varios destinos, exclusión del mismo disco físico, identidad al elegir y ejecutar, desconexión y cambio de montaje, cola, repetición de clics, pausa, programación atrasada, revisión concurrente de ajustes, migración de la configuración y recuperación desde el destino anterior.
- `src/platform/backups.test.ts`: copias reales cifradas, comprobación de SQLite con WAL, recuperación real preservando originales, múltiples carpetas, archivos ocultos y compilaciones, selección con nombres que contienen caracteres especiales, conservación de versiones y comprobación con poco espacio disponible.
- `scripts/backups-browser-qa.cjs`: asistente completo, explorador nativo, intervalo personalizado, persistencia, copia real, recarga, recuperación selectiva y comparación de bytes, edición, pausa/reanudación, descarga de clave, error transitorio/reintento y compatibilidad de rutas. Responsive a 320, 390, 768 y 1440 px y auditoría WCAG A/AA del contenido de Backups.
- `pnpm dlx @21st-dev/cli review public/backups.js public/backups.css`: sin hallazgos.

El navegador y las operaciones reales usaron un home temporal propiedad de QA y discos representados por volúmenes de fixture. Los snapshots y las recuperaciones contienen únicamente archivos de prueba. **No se copiaron archivos personales durante estas pruebas.** La validación local es independiente de la publicación en producción. Las pruebas no afirman haber ejecutado un backup completo del disco del servidor ni simulado la pérdida física de sus discos.

Capturas y comprobantes se guardan junto a este documento, incluido `browser-proof.json`.
