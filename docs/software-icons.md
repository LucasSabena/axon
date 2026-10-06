# Iconos de Programas

AXON no depende de la lista de programas del servidor original. El inventario nativo aporta nombres de paquete, aplicaciones de escritorio, iconos y proyectos de origen. Un catálogo inicial de 9.772 entradas complementa esos metadatos. No todas las entradas representan marcas distintas: los proveedores pueden incluir variantes del mismo producto.

## Fuentes y resolución

1. Selección explícita del administrador para el ID de instalación.
2. Icono instalado de la aplicación, recursos de AXON o icono nativo del mismo proyecto.
3. Coincidencia exacta de nombre/identidad en el catálogo y relaciones conocidas entre paquetes y proyectos.
4. Icono de tipo para aplicaciones, herramientas, scripts, dependencias, runtimes, fuentes o controladores.

El detalle informa si es un logo, un icono del proyecto o un icono de tipo. Una dependencia de Python puede mostrar Python sin presentarse como una aplicación con logo propio. No se inventan logos para scripts locales ni se asignan marcas por coincidencias aproximadas. Las relaciones paquete/proyecto son metadatos opcionales; no restringen el inventario.

Fuentes de Internet:

- [selfh.st/icons](https://github.com/selfhst/icons): colección con atribución CC BY 4.0.
- [Dashboard Icons, Homarr Labs](https://github.com/homarr-labs/dashboard-icons): colección Apache 2.0. Sus alias se usan para buscar, no para resolver automáticamente palabras genéricas.
- [Simple Icons](https://github.com/simple-icons/simple-icons): fuente de marca y licencia individual cuando se informan. La colección puede contener recursos con condiciones diferentes.

Las colecciones facilitan recursos de marcas, pero AXON no certifica que cada archivo sea una publicación directa de su fabricante. Las marcas conservan sus derechos. El selector muestra proveedor, atribución y licencia; el detalle enlaza fuente y licencia cuando existen.

## Persistencia y funcionamiento sin conexión

`software-icons/icons.sqlite`, junto a `config.json`, conserva catálogo, imágenes y selección por instalación. El catálogo se distribuye con AXON, junto con 73 imágenes descargadas y verificadas para las coincidencias actuales. Otros recursos se descargan al necesitarse y quedan guardados. Los recursos nativos siguen leyéndose del servidor que instala AXON.

La actualización del catálogo se intenta en segundo plano, como máximo una vez al día. Se reemplaza sólo si todos los proveedores entregan índices válidos; un fallo conserva la versión anterior. Los archivos remotos usan revisiones Git inmutables, límites de tamaño, timeout, concurrencia limitada y orígenes permitidos. El navegador recibe imágenes desde AXON y no consulta a terceros. Si un recurso aún no guardado no está disponible, recibe un icono de tipo y puede reintentarse después.

El cache de imágenes tiene un presupuesto de 128 MiB. Las selecciones cargadas por el administrador tienen un límite agregado de 32 MiB; cada archivo SVG/PNG tiene un máximo de 1 MiB y PNG de hasta 4096 × 4096. SVG subidos o descargados rechazan scripts, referencias externas y contenido activo. La API exige autenticación y protección CSRF para cambios.

**Elegir icono** permite buscar y seleccionar un recurso, subir SVG/PNG o restaurar detección automática. La selección corresponde a la instalación exacta y no cambia todos los programas con nombres parecidos. Cambiar el icono no ejecuta ni actualiza software del host.

Conservá el directorio de datos en actualizaciones, migraciones y backups. El catálogo y los recursos distribuidos son portables; las selecciones y el cache pertenecen a la instalación. Si no se puede escribir la base, el estado informa el error y se usa almacenamiento temporal en memoria.

## Mantenimiento del catálogo distribuido

```sh
pnpm exec bun run scripts/sync-icon-catalog.ts
pnpm exec bun run scripts/seed-software-icons.ts /ruta/inventario.json
pnpm run check
pnpm run test
pnpm run test:software
pnpm run build
```

El primer comando actualiza índices de los proveedores y fija sus revisiones. El segundo prepara imágenes para las coincidencias de un inventario nativo exportado, sin instalar ni ejecutar los programas enumerados. Los JSON generados están en `src/software-icon-catalog.json` y `src/software-icon-seed.json`.

La API de lectura expone `/api/software/icons-status`, `/api/software/icon-catalog?q=…` y las URLs de iconos de cada registro. El contador `byKind` describe la resolución; para comprobar disponibilidad real se debe descargar la imagen y revisar `X-Axon-Icon-Kind`. Una selección de catálogo puede degradarse a icono de tipo si no se puede obtener su archivo.
