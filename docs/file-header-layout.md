# Cabeceras de Biblioteca y Archivos

Biblioteca ofrece **Discos** desde su barra de herramientas. El modal permite
consultar capacidad, espacio libre, estado de montaje y abrir el volumen en
Archivos. La información no ocupa un panel permanente sobre el contenido.

Archivos organiza su cabecera en tres filas en escritorio:

1. Título, origen (Servidor o conexión de nube), búsqueda, vista y acciones.
2. Historial, ruta navegable, edición de ruta, disco actual y papelera.
3. Filtros y accesos fijados. **Ver** reúne Esta carpeta, Favoritos, Me gusta,
   Guardados y Acceso rápido.

**Nuevo** contiene Nueva carpeta, Nuevo archivo y Subir carpeta. Subir archivos
permanece visible. Los atajos y las acciones contextuales siguen disponibles.
El botón de edición de ruta y Ctrl/Cmd+Shift+L muestran el campo; Enter navega
y Escape cancela. El modal de discos conserva la lista anterior ante errores y
permite reintentar. Su botón indica cuando la actualización falló.

En ventanas angostas las barras permiten desplazamiento horizontal y los
accesos fijados pueden ocupar una fila adicional. Los modales son diálogos
nativos con foco contenido, cierre con Escape y retorno al botón que los abrió.
El cambio entre Servidor y nube mantiene el selector de origen visible.

## Verificación

Con un servidor aislado iniciado mediante `pnpm run qa:serve`:

```sh
pnpm exec bun --no-env-file run scripts/file-headers-browser-qa.ts
```

El script acepta `AXON_QA_ORIGIN` y `AXON_QA_OUTPUT`; exige un servidor local y
su marcador de fixture. Verifica seis anchos (2280, 1440, 1024, 768, 390 y 320),
temas claro y oscuro, edición de ruta, acciones de creación/subida, navegación
de discos, fallo/reintento de inventario, cambio de origen, recarga y
accesibilidad de los overlays. Las conexiones de nube usan respuestas de prueba.
También está incluido en `scripts/qa-run.ts`.

En la comparación a 2280×1308, el inicio del contenido de Archivos pasó de
429 a 206 px (aproximadamente 33% a 16% de la altura total). En Biblioteca pasó
de 411 a 210 px. Estas mediciones incluyen la cabecera global y corresponden a
la validación local; no son una comprobación de publicación en producción.
