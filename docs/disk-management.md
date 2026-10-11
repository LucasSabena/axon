# Discos y particiones en AXON

La vista **Almacenamiento → Discos y particiones** muestra dispositivos físicos,
particiones, formatos y montajes. También muestra dispositivos todavía vacíos.

## Acciones disponibles

- Preparar un disco con una tabla GPT y hasta 16 particiones, cada una con
  nombre, formato y tamaño. Sólo la última puede ocupar el espacio restante.
  Esta acción reemplaza todas las particiones y borra sus datos.
- Agregar particiones al espacio libre final de una tabla GPT, conservando las
  particiones anteriores. Los huecos intermedios y el redimensionamiento no
  están disponibles en este flujo.
- Formatear o eliminar una partición seleccionada, sin modificar las otras.
- Montar y desmontar volúmenes de datos admitidos. No se fuerza un desmontaje.
- Activar o desactivar disponibilidad automática después de reiniciar. Los
  nuevos montajes de AXON usan UUID, `nofail` y automount de systemd.
- Ocultar discos completos o volúmenes. Boot, EFI y las particiones de arranque
  se ocultan por defecto en las listas habituales. **Mostrar ocultos** y
  **Visibilidad de todos los volúmenes** permiten recuperarlos.

Ocultar sólo afecta la presentación. No cambia montajes, rutas permitidas,
permisos, indexación ni planes de respaldo existentes. La preferencia persiste
junto a la configuración de AXON en `disk-visibility.json`.

ext4 conserva permisos, enlaces y características Linux. exFAT permite compartir
archivos con Windows y macOS pero no conserva permisos Linux ni enlaces.
Las opciones faltantes se muestran como no disponibles; el servidor debe tener
las herramientas del formato correspondiente. No se instala software al revisar
un disco.

## Protecciones

El backend sólo acepta IDs de un inventario actual, nunca comandos o rutas de
bloques provistos por el navegador. La revisión congela serie/WWN, by-id,
major/minor, diskseq, tamaño, particiones, montajes y configuración del sistema.
Se verifica nuevamente al ejecutar. Los archivos de dispositivo se mantienen
abiertos y se comprueba `BLKGETDISKSEQ` antes de pasarlos a las herramientas.

Se protegen discos del sistema, arranque, swap, LVM, RAID, cifrado, dispositivos
sin identidad física estable y configuraciones de fstab administradas fuera de
AXON. Los montajes de otros espacios de nombres también cuentan: desmontar en
el host no habilita borrar un disco todavía usado por otro servicio. Los montajes
heredados del host se consideran para verificar el resultado del desmontaje.

Toda mutación necesita sesión de administrador, Origin del panel y JSON. Los
planes duran diez minutos y sólo se ejecutan desde la sesión que los creó. Borrar
requiere escribir `BORRAR <serie>`. Un plan ejecutado no se reutiliza.

El worker mantiene un bloqueo global y recibos durables en
`/var/lib/axon/disk-manager`. Cerrar el navegador o reiniciar AXON no repite la
operación. Un proceso interrumpido se identifica por PID y tiempo de inicio;
queda señalado para revisión, con sus pasos anteriores. No se promete restaurar
archivos borrados. Se conserva la tabla anterior y las copias de ajustes para
diagnóstico; los respaldos de fstab no se exponen al navegador.

## Verificación

- `pnpm run test:disks`: regresiones de seguridad sin modificar dispositivos.
- `pnpm run test`: incluye las preferencias persistentes y los contratos HTTP.
- `pnpm run qa:full`: incluye el asistente simulado, visibilidad, recarga,
  accesibilidad y anchos 1440, 390 y 320.
- Opcional en Linux: `sudo unshare --mount --propagation private python3
  scripts/disks-loop-qa.py`. Crea una imagen temporal y un loop propio; prueba
  GPT, ext4, exFAT, montaje, rechazo de dispositivos montados y conservación
  de archivos al agregar/eliminar particiones. Verifica la imagen de respaldo
  del loop antes de cada operación y antes de liberarlo. No modifica discos
  físicos ni la configuración real de montajes.

Las pruebas no reinician el servidor ni ejecutan operaciones destructivas sobre
el disco del usuario.
