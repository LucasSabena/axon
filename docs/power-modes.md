# Modos de energía y horarios de silencio

Disponible en `/configuracion?section=power`. Complementa el control de ventiladores (`sessions-and-fans.md`) bajando el calor en la fuente en lugar de sólo subir la ventilación.

## Interfases del kernel utilizadas

Sólo interfaces firmadas del kernel; no se escribe EC crudo ni se desactiva Secure Boot.

- `intel_pstate`: `no_turbo` apaga el Turbo Boost y `max_perf_pct` limita la frecuencia máxima. Es el mecanismo real detrás del "thermal throttling": bajar estos valores reduce voltaje, potencia y temperatura.
- `power-profiles-daemon`: si el servicio está activo, el perfil (rendimiento/equilibrado/ahorro) se cambia por D-Bus con `powerprofilesctl set`, de modo que ppd no pise el ajuste en su próxima reevaluación. Sin ppd se escribe `energy_performance_preference` en cada policy de cpufreq.
- RAPL (`/sys/class/powercap/intel-rapl:0`): límites de potencia sostenida (PL1) y de pico (PL2) en watts. Los valores originales se guardan al primer arranque y se restauran fuera del modo silencioso.
- GPU NVIDIA: `nvidia-smi -lgc` limita los relojes en modo silencioso y `-rgc` los restablece. Es mejor esfuerzo: si el controlador lo rechaza, el modo sigue aplicándose y el panel muestra el motivo. También se desactiva el modo persistente (`-pm 0`), que bloquea el suspend RTD3. El panel expone `power_state` del PCI (D0 activa, D3cold suspendida).
- Sueño de la GPU fuera de uso: el bloqueo era el provider "Sink Output" de Xorg sobre los conectores de la dGPU, no el consumo en sí. `/etc/X11/xorg.conf.d/11-axon-nvidia-sleep.conf` desactiva `AllowNVIDIAGPUScreens` (override del archivo que genera gpu-manager) para que Xorg suelte `/dev/dri/card0` y RTD3 suspenda la GPU a D3cold (~1-2 W frente a ~15 W). Sigue funcionando PRIME offload y CUDA; los conectores físicos de la dGPU (HDMI-1-1, DP-1-3) quedan sin display hasta revertir borrando el archivo y reiniciando sesión.
- Ventiladores: en modo silencioso se pide al socket de `axon-fans` un modo manual bajo (30/30% por 60 minutos, renovado en cada ciclo). La guardia térmica del servicio de ventiladores sigue mandando: a 85 °C de CPU u 80 °C de GPU sube todo al máximo. Si el usuario elige manual o máximo en la sección Ventiladores, esa elección gana y el modo silencioso no la pisa; si el servicio de energía muere, el arrendamiento manual vence y el BIOS vuelve a regular.

## Modos

- **Rendimiento**: turbo activo, 100% de frecuencia, perfil `performance`, límites RAPL originales.
- **Equilibrado**: turbo activo, 100%, perfil `balanced` — los valores predeterminados de la plataforma.
- **Silencioso**: turbo apagado, frecuencia al 55%, perfil `power-saver`, RAPL 35/50 W, relojes de GPU limitados y ventiladores bajos.
- **Horarios**: hasta 10 tramos `HH:MM–HH:MM` con modo y días; pueden cruzar la medianoche. Gana el primer tramo que coincida; fuera de los tramos queda Equilibrado. El modo elegido y los tramos se guardan en `/var/lib/axon-power/state.json` y sobreviven reinicios del servicio y del equipo.

## Servicio

`axon-power.service` corre `src/power-host.py` en el host como root, con socket UNIX `/run/axon-power/control.sock` sólo accesible para root y el mismo endurecimiento que `axon-fans.service`. Cada 30 segundos reevalúa el modo efectivo (manual u horario) y lo reafirma: un cambio externo a `no_turbo` no puede dejar el equipo fuera del modo elegido. Al detenerse restaura turbo, frecuencia, perfil `balanced`, límites RAPL originales y suelta los ventiladores; `ExecStopPost` repite la restauración.

El backend valida modo y horarios (`GET/POST /api/power`, revisión contra cambios concurrentes) igual que `/api/fans`. La instalación valida la presencia de `intel_pstate` y habilita el servicio con `sudo deployment/power/install.sh`; `--uninstall` restaura los valores originales y borra `/var/lib/axon-power`.

## Validación

9 pruebas Python con sysfs simulado cubren la exigencia de `intel_pstate`, la aplicación y restauración de cada perilla, la guardia de ventiladores y la prioridad del usuario, tramos que cruzan medianoche, persistencia del estado, solicitudes inválidas y reversión ante fallo de escritura. `power.test.ts` cubre el contrato HTTP con el fixture. La escritura real de RAPL y el bloqueo de relojes de GPU quedan pendientes de verificación física en el host — `nvidia-smi -pl` no aplica en esta laptop (informa N/A) y `-lgc` depende del controlador instalado.
