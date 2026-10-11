#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ $EUID != 0 ]]; then echo 'Ejecutá este instalador con sudo.' >&2; exit 1; fi
[[ $(cat /sys/class/dmi/id/sys_vendor) == Acer && $(cat /sys/class/dmi/id/product_name) == 'Predator PT315-53' && $(cat /sys/class/dmi/id/bios_version) == V1.14 ]] || { echo 'Modelo o BIOS sin validar.' >&2; exit 1; }
if [[ ${1:-} == --uninstall ]]; then
  systemctl disable --now axon-fans.service
  python3 /usr/local/lib/axon/fans-host.py restore
  rm -f /etc/systemd/system/axon-fans.service /etc/modprobe.d/axon-acer-fans.conf /usr/local/lib/axon/fans-host.py
  systemctl daemon-reload
  echo 'Desinstalado. Ventiladores en automático; el próximo arranque usa las capacidades originales.'
  exit 0
fi
[[ $(uname -r) == 7.0.* ]] || { echo 'Este ajuste fue validado para Linux 7.0; comprobá las capacidades del controlador antes de aplicarlo en otra versión.' >&2; exit 1; }
[[ -d /sys/bus/wmi/devices/7A4DDFE7-5B5D-40B4-8595-4408E0CC7F56 ]] || { echo 'Interfaz WMI de Acer ausente.' >&2; exit 1; }
modinfo acer_wmi | rg -q 'force_caps' || { echo 'Falta el controlador nativo.' >&2; exit 1; }
if ! python3 "$source_dir/src/fans-host.py" restore; then
  modprobe -r acer_wmi
  if ! modprobe acer_wmi force_caps=0x1826 || ! python3 "$source_dir/src/fans-host.py" restore; then
    modprobe -r acer_wmi || true
    modprobe acer_wmi
    echo 'No se confirmó el modo automático. Se restauró el controlador original.' >&2
    exit 1
  fi
fi
# HWMON + PWM + existing radio/function capabilities; no thermal profile or OC.
install -d -m 0755 /usr/local/lib/axon
install -m 0644 "$source_dir/src/fans-host.py" /usr/local/lib/axon/fans-host.py
install -m 0644 "$source_dir/deployment/fans/axon-fans.service" /etc/systemd/system/axon-fans.service
printf '%s\n' '# AXON: Acer Predator PT315-53 BIOS V1.14; Linux 7.0 native signed driver.' 'options acer_wmi force_caps=0x1826' > /etc/modprobe.d/axon-acer-fans.conf
chmod 0644 /etc/modprobe.d/axon-acer-fans.conf
systemctl daemon-reload
systemctl enable --now axon-fans.service
for attempt in {1..20}; do
  if [[ -S /run/axon-fans/control.sock ]]; then break; fi
  sleep 0.1
done
printf '{"action":"status"}\n' | python3 "$source_dir/src/fans-host.py"
[[ -S /run/axon-fans/control.sock ]] || { echo 'El servicio no inició. Revisá journalctl -u axon-fans.service.' >&2; exit 1; }
