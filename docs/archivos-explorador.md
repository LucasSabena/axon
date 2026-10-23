# Archivos: explorador unificado

Archivos y Biblioteca son una sola sección. No hay una pestaña «Biblioteca» en la barra lateral: la galería, el visor, los links para compartir, la optimización y la transcripción viven dentro de **Archivos**. Las URLs `/archivos` y `/biblioteca` siguen funcionando; la segunda abre la galería dentro de Archivos y la entrada «Archivos» de la barra lateral queda marcada.

## Estructura de la pantalla

```
┌──────────────┬──────────────────────────────────────────────┐
│ Panel de     │ ← → ↑ ⟳  [ Inicio / ruta / carpeta ]  [Buscar] │
│ navegación   │ [+ Nuevo] [Subir] | Orden ▾  ☰ ▦ ▥  👁   Filtros y más ▾ │
│              │ ┌ Filtros y más (se despliega) ─────────────┐ │
│              │ │ Ver · Tipo · Color · Etiqueta · Organizar │ │
│              │ │ Disco · Papelera · Copiar enlace · Atajos │ │
│              │ └───────────────────────────────────────────┘ │
│              │ Lista / íconos / columnas                      │
└──────────────┴──────────────────────────────────────────────┘
```

La cabecera muestra sólo lo necesario. Los filtros, el disco, la papelera, el enlace de la carpeta y la ayuda de atajos están en **Filtros y más**; el panel se recuerda entre visitas y se abre solo cuando hay un filtro activo.

### Panel de navegación

| Sección | Contenido |
| --- | --- |
| **Acceso rápido** | *Recientes* y *Favoritos* (lo último que pasó en el servidor) y todo lo marcado como «Acceso rápido» (carpetas o archivos). |
| **Este equipo** | *Resumen del equipo* y cada disco (el del sistema incluido) como árbol de carpetas con carga bajo demanda. Un disco sin montar se monta desde acá. La carpeta abierta se despliega sola y las ramas abiertas sólo para llegar a ella se pliegan al cambiar de carpeta. |
| **Galería y colecciones** | Galería (todos los medios), Links compartidos, Transcripciones, Colecciones y Duplicados. Tipo, color y etiqueta se filtran desde el botón **Filtros** de la galería. |
| **Etiquetas** | Todo lo organizado, marcas (Favoritos, Me gusta, Guardados), colores y etiquetas con su cantidad. Abre una vista con los resultados de todo el servidor. |
| **Nube** | Dropbox, Google Drive y OneDrive conectados (sólo lectura) y acceso a Conexiones. |
| **Sistema** | Papelera, historial de transferencias, Almacenamiento y discos, agregar carpeta a la galería. |

El panel se ajusta arrastrando el borde (flechas con foco, doble clic para restablecer), se oculta con `Ctrl/⌘ B` y en pantallas chicas es un cajón. Las carpetas del árbol aceptan arrastrar y soltar para mover o copiar (con `Ctrl` o `Alt`); las subidas desde el sistema también.

El árbol sigue el modelo de teclado de un árbol ARIA: `↑ ↓` mueven, `→` expande o entra, `←` contrae o sube al padre, `Inicio/Fin`, escribir una letra salta por nombre, `Enter` abre y `Esc` vuelve a la lista. Menú contextual sobre cada nodo (abrir, nueva carpeta, pegar, fijar en acceso rápido, copiar ruta…).

## Comportamiento al seleccionar

Como en el Explorador de archivos: **un clic selecciona, doble clic o `Enter` abre**, y en pantallas táctiles un toque abre. Con una vista previa abierta, seleccionar otro archivo cambia la vista previa. Los archivos multimedia que ya están en la biblioteca se abren en el visor completo; el resto en el panel de vista previa o el editor.

## Menú contextual unificado

Un solo diseño para lista, íconos, columnas, resultados de búsqueda y la galería:

1. **Fila rápida:** Cortar, Copiar, Pegar, Renombrar, Eliminar.
2. **Abrir:** Abrir, Vista previa, Abrir en el visor, Editar, Descargar (o `.zip` para carpetas).
3. **Compartir y procesar:** Compartir link…, Optimizar / convertir…, Ver transcripción, Transcribir…
4. **Organizar:** Colores, etiquetas y marcas…, Favorito.
5. **Mover a…, Copiar a…** con selector de carpeta.
6. **Más acciones:** Fijar en acceso rápido, Agregar a una colección o a un link existente, Duplicar, Comprimir, Extraer, copiar ruta o enlace, borrado definitivo.
7. **Propiedades.**

Las entradas muestran su atajo y los submenús se abren con `→`. El espacio vacío tiene su propio menú (Nueva carpeta, Nuevo archivo, Subir, Pegar, Ver, Ordenar por, Papelera, Propiedades). La tecla Menú o `Shift+F10` abren el menú del elemento enfocado.

### Herramientas de la biblioteca desde cualquier archivo

Compartir, optimizar, transcribir y el visor trabajan sobre los archivos de la biblioteca. Archivos entrega rutas y el servidor las resuelve con `POST /api/library/resolve`:

- Funciona con cualquier archivo que el explorador pueda abrir: si está en una carpeta de la galería se indexa en el momento y, si no, AXON recuerda **sólo ese archivo** (no indexa su carpeta ni pregunta nada). Quedan excluidos `/proc`, `/sys`, `/dev`, `/boot`, `.ssh`, `.gnupg`, `.aws` y los `.env`.
- `.ts` y `.mts` sólo se tratan como video cuando ya están indexados, para no confundir código TypeScript con video.

## Barra de selección

Al elegir uno o más elementos aparece una barra inferior con el conteo y el peso: Compartir, Descargar, Copiar, Cortar, Organizar, **más** (el mismo menú agrupado), Eliminar, seleccionar todo y limpiar. Compartir sólo aparece cuando hay archivos y no se está en la papelera.

## Atajos

| Atajo | Acción |
| --- | --- |
| `Ctrl/⌘ B` | Mostrar u ocultar el panel de navegación |
| `Ctrl/⌘ L` · `F4` | Escribir una ruta |
| `Ctrl/⌘ E` · `/` | Enfocar la búsqueda |
| `Ctrl/⌘ F` | Buscar también en subcarpetas |
| `Ctrl/⌘ Shift 1 / 2 / 3` | Vista de lista / íconos / columnas |
| `Ctrl/⌘ U` | Subir archivos |
| `Ctrl/⌘ Shift S` | Compartir link de la selección |
| `Ctrl/⌘ Shift C` | Copiar la ruta |
| `Alt Enter` | Propiedades |
| `F2` · `Supr` · `Shift Supr` | Renombrar · papelera · borrado definitivo |
| `F5` | Actualizar |
| `Menú` · `Shift F10` | Menú contextual del elemento enfocado |
| `Alt ←/→` · `Alt ↑` · `Retroceso` | Historial y carpeta superior |
| `?` | Ayuda completa |

## Qué cambió para quien venía de Biblioteca

- «Agregar carpeta», «Discos», colecciones, tipos y links están en el panel de navegación (sección Biblioteca y Sistema).
- Tipo, color y etiqueta de la galería están en el botón **Filtros** de su barra.
- `Ctrl/⌘ K` ofrece «Archivos: galería de la biblioteca», recientes, favoritos y links compartidos.
- Los enlaces antiguos a `/biblioteca?...` y los links públicos `/s/…` no cambian.

## Notas técnicas

- `public/feat-files.js`: vista de carpeta, menús y barra de selección.
- `public/feat-explorer.js`: panel de navegación, resumen del equipo y galería embebida.
- `public/feat-library.js`: motor de la biblioteca; expone `window.AxonLibrary` (`resolve`, `share`, `tools`, `transcribe`, `view`, `summary`…).
- `public/context-menu.js`: menú contextual con secciones, submenús, atajos, fila de acciones y teclado completo (`showCtxMenu` sigue aceptando el formato anterior).
- `src/library.ts`: `POST /api/library/resolve`; la prueba está en `src/library-resolve.test.ts`.
