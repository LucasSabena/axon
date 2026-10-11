# Sesiones y ventiladores

Publicado en AXON el 11 de octubre de 2026, revisión `sessions-fans-20261011`.

## Sesiones

Disponible en `/configuracion?section=sessions`. Muestra navegador/sistema, nombre personalizable, IP de la última conexión, inicio, última actividad y vencimiento. Cada cookie corresponde a un navegador/perfil, no a una identidad física verificable de computadora. No se infiere ciudad a partir de IP ni se envían IP a proveedores externos. Las sesiones antiguas sin IP conservan “Sin registro anterior” hasta su próxima solicitud autenticada.

Permite cerrar una sesión, la propia o todas las demás. Revocar persiste la denegación antes de confirmar; también cierra WebSockets de terminal/logs/proxy y el stream de eventos inmediatamente. El registro incorpora cookies antiguas únicamente después de verificar su firma. Las sesiones cerradas/vencidas aparecen en el historial opcional. Los identificadores son IDs opacos completos; nunca se muestra la cookie firmada.

Rutas protegidas por autenticación, comprobación de origen y respuestas `private, no-store`:

- `GET /api/sessions`
- `PATCH /api/sessions/:jti` con `{name}`
- `POST /api/sessions/:jti/revoke`
- `POST /api/sessions/revoke-others`

## Acer Predator Triton 300 PT315-53

Disponible en `/configuracion?section=fans`. Hardware verificado: Acer Predator PT315-53, placa TGL Civic_TLS, BIOS V1.14, Linux `7.0.0-38-generic`, Secure Boot habilitado.

Se analizaron DSDT y SSDT del firmware, únicamente por lectura. `SSDT12` publica `\\_SB.PC00.WMID.WMBH`, correspondiente al GUID `7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56`, con estos métodos:

- 5: sensores disponibles `0x0227` y telemetría CPU/GPU/RPM.
- 14/15: establecer/consultar comportamiento de ventiladores.
- 16/17: establecer/consultar potencia independiente, CPU ID 1 y GPU ID 4; el propio firmware valida 0–100.

El kernel firmado `acer_wmi` implementa este protocolo, pero no incluye este modelo en su tabla de capacidades. Se comprobó que `force_caps=0x1826` expone `hwmon` y PWM conservando radio/funciones existentes, sin activar perfiles de rendimiento ni overclock. No se reemplaza el módulo, no se escribe EC crudo y no se desactiva Secure Boot. El depurador ACPI está bloqueado por lockdown; no se intentó eludir esa protección.

La instalación específica está en `deployment/fans/install.sh`: valida modelo, BIOS y kernel, verifica AUTO y habilita `axon-fans.service`. El ajuste queda en `/etc/modprobe.d/axon-acer-fans.conf`. El kernel actual no carga `acer_wmi` desde su initramfs; no fue necesario regenerarlo. No se reinició la computadora, por lo que el próximo arranque sigue pendiente de verificación física. Otro BIOS/kernel requiere revisar el adaptador antes de instalarlo.

El servicio usa el módulo nativo por sysfs y un socket UNIX del host privado de root; no abre puertos. AXON se conecta a él a través del adaptador de host existente. GET consulta, POST aplica con una revisión para rechazar cambios concurrentes.

- Automático: el BIOS regula ambos ventiladores.
- Máximo: ambos en máximo, sin cambiar potencia CPU/GPU ni overclock.
- Manual: CPU y GPU independientes, 20–100%, durante 15, 30 o 60 minutos. Al vencer vuelve a AUTO.
- Guardia cada segundo: CPU ≥85 °C o GPU ≥80 °C activa máximo; temperaturas ausentes/implausibles también. Se recupera el control manual por debajo de CPU 75 °C y GPU 70 °C.
- Al detenerse/fallar el servicio restaura AUTO; `ExecStopPost` repite la restauración y systemd reinicia ante fallo. El servicio funciona independientemente del contenedor de AXON.
- No se reintentan escrituras de forma ciega desde el navegador. Los controles retienen borradores ante polling y las acciones necesitan confirmación del firmware.

## Validación

Prueba física: AUTO ~2360/2360 RPM; CPU 60% y GPU 70% ~2970/4840–4920 RPM; máximo ~3529/5882 RPM; restauración AUTO confirmada. La velocidad no es lineal respecto del porcentaje ni representa consumo eléctrico en watts. Detener `axon-fans.service` durante MANUAL restauró ambos canales a AUTO. No se forzó sobretemperatura real.

`pnpm run build` y `pnpm run check` correctos; suite completa inicial 336 pruebas correctas; regresión adicional de revocación SSE y pruebas focalizadas correctas; 8 pruebas Python verifican modelo/BIOS, límites, sensores inválidos/ausentes, histéresis, vencimiento, revisión obsoleta y fallo parcial del hardware con restauración de ambos canales.

QA en fixtures y en HTTPS real: 1440, 768, 390 y 320 px, enlaces directos, recarga, edición de nombres, revocación de una sesión propia de QA, conservación de la sesión actual y control real MANUAL/MÁXIMO/AUTO. En producción el cierre del WebSocket de logs tardó ~104 ms. No se revocaron sesiones ajenas para probar. Se comprobó recarga con navegador/caché existente y ausencia de errores JavaScript. La prueba de “cerrar todas las otras” se hizo sólo en fixtures.

Despliegue acotado: 12 archivos, 671 archivos anteriores preservados, mismos montajes/configuración y 29 contenedores vecinos en ejecución. Paridad de los archivos de esta función confirmada entre fuente/contenedor. Shell y service worker de producción conservan las versiones de los demás módulos; el árbol de trabajo contiene cambios previos y no se publicó completo.

Rollback del panel: imagen `axon:rollback-sessions-fans-20261011`, contenedor detenido `axon-rollback-sessions-fans-20261011`. Desinstalar el servicio de hardware con `sudo deployment/fans/install.sh --uninstall` devuelve AUTO y retira sus propios archivos; no elimina proyectos ni datos de AXON. No se creó commit/PR ni se ejecutó CI remoto.

## Fuentes

- [Código oficial de Linux 7.0, acer-wmi](https://github.com/torvalds/linux/blob/v7.0/drivers/platform/x86/acer-wmi.c).
- [Manual oficial Acer PT315-53](https://global-download.acer.com/GDFiles/Document/User%20Manual%20W11/User%20Manual%20W11_Acer_1.0_A_A.pdf?BC=ACER&LC=en&OS=ALL&SC=PA_6&Step3=PREDATOR+PT315-53&acerid=637708104499651600).
- [Linuwu-Sense, implementación comunitaria WMI](https://github.com/0x7375646F/Linuwu-Sense). Se comparó el protocolo; no se instaló este reemplazo del controlador.
- [Gestión de sesiones de GitHub](https://docs.github.com/en/enterprise-cloud%40latest/authentication/keeping-your-account-and-data-secure/viewing-and-managing-your-sessions), referencia funcional para identificar sesión actual, actividad y cierre individual.
