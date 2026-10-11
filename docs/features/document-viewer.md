# Visor de documentos en Archivos y Biblioteca

Los dos módulos usan el mismo visor de lectura. En Archivos, los documentos
paginados y las planillas se abren en el panel lateral; Markdown se abre en un
área de lectura con acceso al editor. **Vista previa** en el menú del archivo
también permite usar el panel lateral. En Biblioteca, abrir el elemento muestra
el visor. El original siempre se puede descargar.

| Formatos | Vista |
| --- | --- |
| MD, Markdown | Lectura con el tema de AXON, títulos, listas, tareas, tablas, enlaces y bloques de código |
| PDF, DOC/DOCX, ODT, RTF | Páginas, texto seleccionable, ancho/página, zoom y pantalla completa |
| PPT/PPTX, PPS/PPSX, ODP | Diapositivas, navegación por páginas, zoom y pantalla completa |
| XLS/XLSX, ODS | Tabla de valores, selector de hojas y búsqueda; independiente del área de impresión |
| CSV, TSV | Tabla paginada, búsqueda, selector de separador y detección UTF-8/UTF-16/Windows-1252 |

También se admiten las variantes de plantillas y documentos con macros
registradas en `OFFICE_EXTENSIONS`. Las macros no se ejecutan. El visor de
planillas muestra valores de lectura; no es un editor de fórmulas, gráficos o
formatos. Las presentaciones son estáticas. La conversión puede sustituir fuentes
que no estén instaladas. Archivos dañados, vacíos, con contraseña o que excedan
los límites muestran un error, reintento y descarga del original.

En Archivos, los `.md` y `.markdown` se abren en **Visualizador**. Los botones
**Visualizador / Editor**, o `Ctrl/Cmd+E`, cambian la vista del mismo documento
sin recargarlo ni perder el texto, el cursor o los cambios pendientes. La lectura
muestra también el borrador sin guardar; Guardar mantiene la revisión/diff y las
protecciones existentes. `Ctrl/Cmd+S` funciona en ambas vistas. Salir con cambios
pendientes sigue pidiendo confirmación. `edit=1` abre directamente el editor.
Biblioteca usa el mismo lector, sin iframe y con contraste acorde al tema.

Markdown usa un parser CommonMark local, cargado bajo demanda. El HTML escrito
en el documento se muestra como texto y no se ejecuta. Las imágenes relativas
pasan por la API de vista previa autenticada; los enlaces a archivos abren
Archivos. La lectura se limita a 512 KB y avisa si está truncada. Un documento
binario o con UTF-8 inválido no se interpreta como Markdown.

## Procesamiento y protección

- PDF.js y sus fuentes/decodificadores se distribuyen localmente, desde la
  dependencia fijada en el lockfile. El motor pesado sólo se descarga al abrir
  un documento PDF o una conversión paginada.
- LibreOffice trabaja sobre una copia temporal de un descriptor regular sin
  seguir enlaces, revalidada antes y después. Bubblewrap crea espacios privados
  de archivos, procesos y red, elimina las variables de entorno y capacidades,
  y ejecuta sin privilegios. No se montan `/hostfs`, datos de AXON ni credenciales.
- Las dos APIs mantienen sus permisos de rutas/discos y sesiones. También
  revalidan el original al entregar una conversión almacenada. Las respuestas
  son `private, no-store`; una URL de otra revisión devuelve 409.
- Dos conversiones simultáneas, hasta 16 en cola, 65 segundos por conversión,
  2 GB de memoria por proceso y 100 MB de entrada/salida. Los contenedores ZIP
  tienen límites de expansión y cantidad de entradas.
- Caché compartida en `document-previews`, junto a la configuración: máximo
  512 MB, 100 vistas y siete días. Los identificadores incluyen ruta, dispositivo,
  inode, tamaño, mtime y ctime. Las copias temporales se eliminan al terminar;
  una preparación interrumpida se limpia posteriormente en esa misma caché.
- Tablas: hasta 50 hojas, 10.000 filas por hoja, 100 columnas y 100.000 celdas,
  con aviso cuando se limita una vista. CSV/TSV admiten hasta 5 MB y se dibujan
  en páginas de 100 filas; el contenido se inserta como texto, sin HTML ejecutable.
- Cambiar de archivo o sección cancela polling, render y recursos del visor.
  Una respuesta atrasada no reemplaza el documento actual.

## Instalación y pruebas

La imagen Docker incluye Writer, Calc, Impress, Bubblewrap y fuentes Carlito,
Caladea y Liberation. Una instalación nativa necesita los mismos paquetes y
espacios de nombres de Linux habilitados. Si falla el aislamiento, el visor
rechaza la conversión; PDF y CSV/TSV siguen funcionando en el navegador.

Ubuntu 24.04 puede bloquear las capacidades dentro de espacios de nombres
no perfilados. Para una instalación **nativa**, el administrador puede cargar
`deployment/document-preview.apparmor` con
`sudo apparmor_parser -r deployment/document-preview.apparmor`. El permiso
se aplica exclusivamente a `/usr/bin/bwrap`: no se desactivan las restricciones
globales de AppArmor ni se habilita acceso del documento al host o a la red.
La imagen y el despliegue Docker de AXON ya usan sus propios espacios aislados.
Referencia: https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces

`pnpm run test` incluye conversiones reales de DOC/DOCX, PPT/PPTX, XLS/XLSX,
ODT/ODP/ODS y RTF, conservación del original, revisiones, concurrencia,
entradas inválidas, CSV y aislamiento. Estas pruebas necesitan `poppler-utils`
para comprobar el contenido PDF, además del motor de conversión.

`pnpm run qa:full` incluye `document-viewer-browser-qa.cjs`: ambas rutas,
contenido y controles reales, hojas, tablas, carga diferida, teclado, pantalla
completa, respuestas tardías, errores, permisos, temas, 320–1440 px y WCAG A/AA.
Las operaciones se realizan exclusivamente en el servidor de fixtures propio.
`markdown-viewer-browser-qa.cjs` cubre además lectura, alternancia, borradores,
guardado, revisión, seguridad, cancelación, temas y tamaños de pantalla.
