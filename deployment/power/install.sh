#!/usr/bin/env bash
set -euo pipefail
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
if [[ $EUID != 0 ]]; then echo 'Ejecutá este instalador con sudo.' >&2; exit 1; fi
[[ -d /sys/devices/system/cpu/intel_pstate ]] || { echo 'Este equipo no expone intel_pstate.' >&2; exit 1; }
if [[ ${1:-} == --uninstall ]]; then
  systemctl disable --now axon-power.service || true
  python3 /usr/local/lib/axon/power-host.py restore || true
  rm -f /etc/systemd/system/axon-power.service /usr/local/lib/axon/power-host.py
  rm -rf /var/lib/axon-power
  systemctl daemon-reload
  echo 'Desinstalado. Turbo y límites de consumo volvieron a sus valores originales.'
  exit 0
fi
install -d -m 0755 /usr/local/lib/axon
install -m 0644 "$source_dir/src/power-host.py" /usr/local/lib/axon/power-host.py
install -m 0644 "$source_dir/deployment/power/axon-power.service" /etc/systemd/system/axon-power.service
systemctl daemon-reload
systemctl enable --now axon-power.service
for attempt in {1..30}; do
  if [[ -S /run/axon-power/control.sock ]]; then break; fi
  sleep 0.1
done
printf '{"action":"status"}\n' | python3 "$source_dir/src/power-host.py"
[[ -S /run/axon-power/control.sock ]] || { echo 'El servicio no inició. Revisá journalctl -u axon-power.service.' >&2; exit 1; }
