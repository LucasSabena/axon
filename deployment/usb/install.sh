#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ $EUID != 0 ]]; then echo 'Ejecutá este instalador con sudo.' >&2; exit 1; fi
if [[ ${1:-} == --uninstall ]]; then
  systemctl disable --now axon-usb.service
  python3 /usr/local/lib/axon/usb-host.py restore
  rm -f /etc/systemd/system/axon-usb.service /usr/local/lib/axon/usb-host.py
  systemctl daemon-reload
  exit 0
fi
[[ -d /sys/bus/usb/devices ]] || { echo 'El host no expone USB en sysfs.' >&2; exit 1; }
if systemctl is-active --quiet axon-usb.service; then systemctl stop axon-usb.service; fi
install -d -m 0755 /usr/local/lib/axon
install -m 0644 "$source_dir/src/usb-host.py" /usr/local/lib/axon/usb-host.py
install -m 0644 "$source_dir/deployment/usb/axon-usb.service" /etc/systemd/system/axon-usb.service
systemctl daemon-reload
systemctl enable --now axon-usb.service
for attempt in {1..30}; do
  if [[ -S /run/axon-usb/control.sock ]]; then break; fi
  sleep 0.1
done
[[ -S /run/axon-usb/control.sock ]] || { echo 'El servicio no inició. Revisá journalctl -u axon-usb.service.' >&2; exit 1; }
