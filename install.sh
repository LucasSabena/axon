#!/usr/bin/env bash
set -euo pipefail
# Bootstrap from a public checkout. The manager then pins the actual Git commit.
for tool in git python3 docker; do
  command -v "$tool" >/dev/null || { printf 'Falta %s. Instalalo antes de continuar.\n' "$tool" >&2; exit 1; }
done
axon_bootstrap="$(mktemp -d)"
trap 'rm -rf -- "$axon_bootstrap"' EXIT
git clone --depth 1 --branch main https://github.com/LucasSabena/axon.git "$axon_bootstrap/source"
python3 "$axon_bootstrap/source/deployment/axon.py" install "$@"
