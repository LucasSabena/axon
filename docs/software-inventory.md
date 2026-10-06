# Programas: inventario nativo y actualizaciones

Programas enumera lo instalado en el host. Tienda, las integraciones de Agentes y el inventario físico de Mantenimiento reutilizan esos registros. El catálogo de recomendaciones sirve para instalar aplicaciones conocidas; no limita lo que puede aparecer como instalado.

No requiere cuentas de servicios de logos ni scripts específicos del servidor original. La lectura no instala gestores, no actualiza índices APT y no ejecuta cada programa para averiguar su versión. Los ejecutables locales sin registro aparecen con origen y versión no comprobados.

## Cobertura

| Fuente | Inventario | Actualización desde AXON |
| --- | --- | --- |
| APT/dpkg | Paquetes instalados, arquitectura, descripción, marcas manuales, holds | Versión exacta, simulación de dependencias, sin retirar paquetes; requiere administrar el host |
| Snap | Paquetes, canal, versión, revisión y holds | Revisión exacta; requiere administrar el host |
| Flatpak | Aplicaciones y runtimes, sistema, usuario e instalaciones nombradas; ref y origen | Commit exacto, respetando masks y ámbito. Las dependencias y extensiones se actualizan como registros separados |
| pnpm global | Dependencias directas, prefijo real, versiones y ejecutables | Misma instalación y usuario; candidato sujeto a `minimumReleaseAge` y exclusiones |
| Bun global | Manifest y paquetes del ámbito global | Versiones exactas del registro público; configuraciones de registro, publicación o scanner que no se pueden resolver quedan sin actualización automática |
| DNF/RPM, Pacman | Base de paquetes y candidatos nativos | Sólo lectura; DNF necesita simulación propia y Arch requiere una transacción completa del sistema |
| pipx, uv, Cargo, rustup | Herramientas permanentes, crates y toolchains registrados | Sólo lectura; no se cambian proyectos, pins, fuentes git ni perfiles por aproximación |
| Homebrew, Nix, mise | Registros nativos cuando el formato es compatible | Sólo lectura; errores y formatos incompatibles aparecen en Fuentes |
| asdf | Presencia del gestor | Adaptador de inventario pendiente, declarado en Fuentes |
| Escritorio, AppImage y ejecutables locales | `.desktop` y directorios locales/configurados, con límites de exploración | Sin actualización automática hasta comprobar su mecanismo de instalación |
| Docker / Compose | Inventario existente de contenedores e imágenes | Mantiene su recorrido de despliegue separado |

Los registros JavaScript instalados por fuentes locales, git o aliases conservan su origen y no se reemplazan por un paquete del registro. Los registros pnpm privados o por scope se muestran, pero no se consulta un registro público como sustituto. Tampoco se migran instalaciones del host a pnpm durante la detección.

El helper usa Python 3 y bibliotecas estándar del host. Python 3.11 permite interpretar configuraciones Bun TOML; en una versión anterior esa configuración se declara incompleta. Un gestor ausente no bloquea los demás. Un error no equivale a cero instalaciones: se conserva la última lectura y se deshabilitan cambios sobre esa fuente.

## Identidad y ámbito

Cada instalación tiene un ID derivado de gestor, ámbito, UID, raíz/prefijo, paquete o ref y arquitectura. Dos versiones del mismo producto instaladas con gestores o usuarios distintos siguen siendo registros separados. Los homes salen de la base de cuentas del sistema, incluyendo cuentas cuyo home no está en `/home`.

Por defecto se consulta el sistema y el usuario del host configurado en AXON. No se recorren indiscriminadamente los homes de todas las cuentas. Para agregar cuentas o rutas de gestores, creá `software.json` junto a `config.json`:

```json
{
  "users": ["deploy"],
  "contexts": {
    "deploy": {
      "paths": ["/srv/deploy/tools/bin"],
      "environment": {
        "PNPM_HOME": "/srv/deploy/pnpm",
        "XDG_DATA_HOME": "/srv/deploy/data"
      },
      "iconTheme": "hicolor"
    }
  },
  "ignored": []
}
```

Las cuentas y rutas del ejemplo deben existir en el host. La configuración admite hasta ocho cuentas adicionales y una lista limitada de variables de ubicación; no transporta credenciales del registro al navegador. `ignored` contiene IDs de instalaciones que se quieran retener en AXON. La configuración inválida bloquea la lectura/planificación en vez de aplicar un ámbito aproximado.

Las rutas estándar de usuario y `/usr/local/bin` también se enumeran sin ejecutar sus archivos. Hay un límite de 2.000 entradas; alcanzar el límite o perder acceso queda informado como lectura incompleta.

## Logos

La resolución combina iconos instalados del escritorio/AppStream, recursos distribuidos con AXON y un catálogo portable de selfh.st, Dashboard Icons y Simple Icons. Las coincidencias automáticas usan identidades exactas y relaciones de proyecto; las palabras genéricas de los catálogos sirven para búsqueda manual. Las dependencias pueden usar la marca del proyecto padre, declarada como tal. Cuando no hay una identidad fiable se muestra un icono de tipo.

En el detalle de cada instalación, **Elegir icono** permite buscar en el catálogo, subir SVG/PNG o volver a la detección automática. Las selecciones y las imágenes quedan en una base SQLite dentro de los datos de AXON. No se necesitan cuentas ni claves de servicios de logos. Los archivos se sirven autenticados desde AXON, sin solicitudes del navegador a los proveedores.

Ver [catálogo, atribuciones, cache y mantenimiento](software-icons.md).

## Revisar y ejecutar

1. Elegí una instalación o seleccioná hasta 200 registros. La búsqueda y los filtros sobreviven a recargar la página.
2. AXON vuelve a leer los gestores y crea un plan con objetivos exactos. APT muestra todos los cambios de su simulación. Otros adaptadores indican que no ofrecen una simulación completa de dependencias.
3. Confirmá ese plan. Vence a los diez minutos y deja de existir al reiniciar AXON.
4. El executor toma locks del host por gestor/ámbito/prefijo, además de la coordinación común entre Tienda y Programas. Relee la instalación, el candidato y la simulación antes de ejecutar. Un cambio invalida el plan.
5. Tras el comando, verifica la versión, revisión o commit en el registro nativo. Salir con código cero sin instalar el objetivo es un fallo visible.

Un lote puede tener resultados parciales: una transacción fallida detiene su grupo, y otros gestores pueden completar sus operaciones. No hay rollback general de paquetes o migraciones de datos. No se reejecuta automáticamente un trabajo interrumpido al reiniciar AXON; verificá el gestor y el historial antes de crear otro plan. Los locks del host no dependen de la vida de la petición HTTP.

**Actualizar índices** consulta repositorios APT sin instalar paquetes. La fecha de los índices locales aparece en Fuentes. Las lecturas de versiones remotas se realizan en segundo plano; fallos de red y registros demasiado grandes aparecen como errores, no como “al día”.

## Recetas locales opcionales

`hooks` en `software.json` permite una receta propia para un paquete global pnpm/Bun. Se separa en su transacción y se anuncia en el plan. No es un requisito del proyecto ni se configura automáticamente:

```json
{
  "hooks": {
    "my-tool": "/srv/admin/update-my-tool --version \"$AXON_TARGET_VERSION\""
  }
}
```

La receta recibe `AXON_PACKAGE` y `AXON_TARGET_VERSION`; debe instalar exactamente el objetivo revisado. Su salida sigue en el historial y la verificación posterior es obligatoria. Estos comandos son configuración local del administrador, nunca datos de catálogos o de peticiones de actualización.

## Desarrollo y actualización de AXON

- `pnpm run check`: tipos y sintaxis del frontend.
- `pnpm run test`: contratos de API, cache, candidaturas e integración existente.
- `pnpm run test:software`: fixtures Python de gestores, identidad, simulación, locks, metadatos y verificación posterior, sin actualizar paquetes del host.
- `pnpm run build`: incluye el helper Python en el artefacto distribuido y actualiza las huellas del frontend.

Las rutas heredadas de actualización piden revisar el plan nuevo. Una pestaña con JavaScript antiguo recibe una indicación de recargar en lugar de iniciar una receta vieja. Para publicar, usá el procedimiento normal de actualización y recuperación de AXON, conservando `config.json`, `software.json` y el resto del directorio de datos. Cambiar la versión de AXON no actualiza automáticamente paquetes del servidor.

Referencias y decisiones: [investigación previa](programs-discovery-research-2026-10-06.md), [Flatpak: ámbitos, máscaras y commits](https://docs.flatpak.org/en/latest/flatpak-command-reference.html), [políticas pnpm](https://pnpm.io/settings#minimumreleaseage), [políticas Bun](https://bun.sh/docs/pm/cli/install#minimum-release-age).
