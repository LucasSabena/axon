#!/usr/bin/env bash
set -euo pipefail
# Bootstrap from a public checkout. The manager then pins the actual Git commit.
for tool in git python3 docker; do
  command -v "$tool" >/dev/null || { printf 'Falta %s. Instalalo antes de continuar.\n' "$tool" >&2; exit 1; }
done
axon_repo=https://github.com/LucasSabena/axon.git
# Releases are cut as v* tags; install the newest one instead of a moving HEAD.
# Set AXON_REF to an exact tag or branch to reproduce a specific install.
# When no tags exist yet, pin the commit currently at HEAD — still immutable.
axon_tags="$(git ls-remote --tags --refs "$axon_repo" 'v*' | sed 's#.*refs/tags/##')"
# Prefer finals over prereleases of the same version (sort -V ranks -rc above
# the bare release); fall back to a prerelease only when no final exists.
axon_ref="${AXON_REF:-$(printf '%s\n' "$axon_tags" | grep -v -- '-' | sort -V | tail -n 1)}"
axon_ref="${axon_ref:-$(printf '%s\n' "$axon_tags" | sort -V | tail -n 1)}"
axon_ref="${axon_ref:-$(git ls-remote "$axon_repo" HEAD | awk '{print $1}')}"
axon_ref="${axon_ref:-main}"
axon_bootstrap="$(mktemp -d)"
trap 'rm -rf -- "$axon_bootstrap"' EXIT
# fetch + FETCH_HEAD checkout works uniformly for tags, branches and raw SHAs
# (git clone --branch rejects the latter).
git -C "$axon_bootstrap" init -q source
git -C "$axon_bootstrap/source" remote add origin "$axon_repo"
git -C "$axon_bootstrap/source" fetch -q --depth 1 origin "$axon_ref"
git -C "$axon_bootstrap/source" checkout -q FETCH_HEAD
# An explicit --ref in "$@" still wins: argparse takes the last occurrence.
python3 "$axon_bootstrap/source/deployment/axon.py" install --ref "$axon_ref" "$@"
