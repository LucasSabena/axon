# Control USB y diagnóstico del disco ausente

Publicado en `https://ports.binaryserver.com.ar/configuracion?section=usb`.

## Resultado del diagnóstico, 11 de octubre de 2026

Host Acer Predator PT315-53, BIOS V1.14, Linux 7.0.0-38-generic. El Toshiba MQ01ABD075 de 750 GB, UUID `9b6a2e73-0a1c-4922-bb18-5fe81328254d`, está detectado y montado en `/mnt/axon-disks/35e9e6ca634f7538`. El volumen Western Digital DATOS de 2 TB, UUID `03252d72-d684-49c8-a069-6297539c5133`, permanece ausente. Su automount `/mnt/DATOS` sigue configurado; no es un problema de formato ni de inventario de AXON.

Desde el inicio del arranque, el kernel repite `usb usb4-port1: Cannot enable. Maybe the USB cable is bad?`. Eso señala un fallo de enlace/enumeración; no demuestra por sí solo que el cable sea la causa. Se probó deshabilitar/habilitar juntos sus canales USB 2/3, y deshabilitar temporalmente sólo SuperSpeed para intentar USB 2. Ninguna prueba hizo aparecer el WD. Todos los canales intervenidos fueron habilitados al terminar.

Los cuatro root hubs declaran `wHubCharacteristic 0x000a`, sin conmutación de energía. `uhubctl 2.6.0` no detecta hubs compatibles. Las tablas ACPI no aportaron una operación verificada para cortar los 5 V de esos conectores. **La implementación controla el enlace de datos; no promete un corte VBUS.** No se hicieron escrituras EC/GPIO ni modificaciones del firmware.

Para recuperar ahora el WD hace falta probar una desconexión física de unos 10 segundos y volver a conectarlo; si sigue sin enumerar, probar otro cable/puerto permite continuar el diagnóstico. Para cortar/restablecer alimentación individual por software se necesita un hub con PPPS y corte VBUS comprobado para su modelo y revisión. La compatibilidad anunciada por un descriptor, por sí sola, tampoco confirma un corte eléctrico.

Fuentes primarias: [uhubctl, requisitos y dualidad USB 3](https://github.com/mvp/uhubctl), [ABI Linux de puertos USB](https://github.com/torvalds/linux/blob/v7.0/Documentation/ABI/testing/sysfs-bus-usb).

## Interfaz y contrato

`GET /api/usb` descubre puertos, dispositivos, almacenamiento, identidad, protección, operación activa y volúmenes persistentes ausentes. Agrupa los canales que comparten conector mediante `peer`; para este Acer/BIOS también agrupa USB-C mediante su ubicación ACPI común, porque los canales pertenecen a controladores PCI diferentes.

`POST /api/usb` acepta únicamente `id`, `token`, `operation` y `seconds`. Las operaciones son `cycle` (5 segundos), `disconnect` (15/30/60 segundos; la interfaz ofrece 30) y `enable`. Devuelve 202 cuando acepta el trabajo; su resultado se consulta en el inventario. Una operación completada confirma habilitación de los canales, no recuperación del dispositivo ni corte eléctrico.

El inventario muestra los 29 canales lógicos en 25 grupos, con cuatro conectores externos. Los puertos internos, sin ubicación externa confirmada y no utilizados se pueden inspeccionar. Su control queda bloqueado. También se bloquean interfaces de red/entrada/no revisadas y discos montados, swap o miembros de almacenamiento compuesto. La identidad se comprueba nuevamente antes de ejecutar; los discos sin montar se reclaman con `O_EXCL` para rechazar dispositivos abiertos y montajes concurrentes.

## Servicio independiente y restauración

Instalar con `sudo bash deployment/usb/install.sh`. `axon-usb.service` usa el helper root `/usr/local/lib/axon/usb-host.py` y socket privado `/run/axon-usb/control.sock`, accesible sólo a root. AXON utiliza su mecanismo existente de entrada al host; QA inyecta un runner simulado que no toca hardware.

Antes de desconectar, el servicio escribe un diario privado y durable en `/var/lib/axon-usb/leases.json`. El trabajador controla ambos canales y comprueba la lectura `disable`. El temporizador es monotónico, independiente del navegador y de ajustes del reloj. Al detener o reiniciar el servicio, `ExecStopPost`/inicio restauran únicamente sus propios puertos y nunca aplican el diario a otro hub. La identidad incluye objeto kernel y arranque. Las operaciones físicas USB pueden tardar más que el período de espera debido a bloqueos del controlador; la interfaz muestra esos estados.

No hay recuperación automática periódica de discos ausentes ni reinicios generales del controlador PCI. Detener AXON no detiene el servicio USB. Para desinstalar, `sudo bash deployment/usb/install.sh --uninstall` primero restaura sus puertos.

## Validación y despliegue

- Nueve pruebas Python cubren canales compartidos, USB-C, montajes, cambios de dispositivo, exclusividad, fallo parcial y restauración del diario sin tocar hubs reemplazados.
- Trece pruebas Bun de USB, sesiones, ventiladores, eventos y almacenamiento pasaron con configuración aislada. Build, TypeScript, sintaxis de 118 archivos frontend y comprobación de diff pasaron.
- QA local y HTTPS público en 1440/768/390/320 px: enlace directo, recarga, puertos protegidos, rechazo API de un disco montado y reconexión de un puerto vacío. Cero errores JavaScript. Una sesión/caché existente sobrevivió la publicación.
- En hardware real se comprobó `disable=1/0` en ambos canales, restauración al detener el servicio durante una desconexión y restauración automática por temporizador. Ningún disco conectado fue desconectado en estas pruebas.
- Release final `usb-20261011-2`; configuración, montajes y 29 contenedores vecinos preservados. Se verificó la igualdad de los archivos locales publicados y del helper instalado. Rollback inicial: contenedor detenido `axon-rollback-usb-20261011` / imagen `axon:rollback-usb-20261011`.

Evidencia: `docs/qa/usb-2026-10-11/`. No se reinició el equipo; el servicio está habilitado para iniciar con systemd, pero su arranque tras un reboot real queda sin comprobar.

## Prueba adicional autorizada: reinicialización completa del controlador

El 11 de octubre, de 11:57:37 a 11:58:04, se ejecutó una recuperación única del controlador PCI `0000:00:14.0` mediante unbind/bind de `xhci_hcd`. Antes se comprobaron cero bloqueos de transferencias y ningún archivo abierto en el Toshiba, se detuvo AXON, se desactivaron los automounts temporalmente y se desmontó el disco normalmente. Un servicio transitorio systemd ejecutó `scripts/usb-controller-recovery.py` con un `ExecStopPost` independiente para volver a conectar el controlador y restaurar los servicios/montajes por UUID ante una interrupción. El script y su estado están instalados bajo rutas root; la operación ya registrada no se repite automáticamente.

**El controlador se reinicializó correctamente, pero el WD no reapareció.** El campo `ok` del recibo confirma ejecución/restauración; `wdDetected: false` indica que la recuperación del disco ausente no se logró. El mismo fallo de enumeración volvió después de inicializar los buses.

Se comprobó que el Toshiba volvió con el mismo UUID y montaje, conservando el listado de raíz, y respondió a una prueba temporal de lectura/escritura de 4096 bytes con fsync, ejecutada como root y eliminada al terminar. La raíz del volumen sigue con sus permisos anteriores `root:root 0755`; no se modificaron propietarios ni permisos. Eso valida almacenamiento y montaje, no permisos de escritura del usuario no privilegiado.

La cámara volvió a exponer ambos nodos V4L2 y respondió a `VIDIOC_QUERYCAP`, sin capturar imágenes. Bluetooth volvió a exponer `hci0` con `btusb` y contadores de comandos/eventos sin errores; el adaptador está DOWN y bluetooth.service inactivo, por lo que no se afirma haber probado una conexión Bluetooth externa. AXON, el servicio USB y la protección térmica siguen activos; el panel público volvió a pasar las pruebas de dispositivos protegidos, reconexión de puerto vacío y escritorio/móvil.

Durante la eliminación del controlador, el kernel registró un fallo de su intento final de `Synchronize Cache(10)` después del desmontaje/sincronización. El Toshiba reapareció y se montó normalmente; no se observaron errores ext4 o de I/O después de la restauración, y la prueba de lectura/escritura terminó correctamente. No se realizó una comprobación integral de todos los datos del volumen.

Los recibos, el log de la unidad y la QA posterior están en la carpeta de evidencia. Esta prueba completa las alternativas de recuperación verificadas por software en esta sesión; sigue pendiente una reconexión eléctrica del WD mediante intervención física o hardware compatible.
