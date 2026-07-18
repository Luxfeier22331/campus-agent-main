#!/usr/bin/env bash
set -euo pipefail

if ! command -v osv-scanner >/dev/null 2>&1; then
	echo "osv-scanner v2.3.8 is required" >&2
	exit 1
fi

if (( $# == 0 )); then
	set -- node python rust go
fi
lockfiles=()
for ecosystem in "$@"; do
	case "$ecosystem" in
		node) lockfiles+=(--lockfile pnpm-lock.yaml) ;;
		python) lockfiles+=(--lockfile uv.lock) ;;
		rust) lockfiles+=(--lockfile Cargo.lock) ;;
		go) lockfiles+=(--lockfile apps/execution-control/go.mod) ;;
		*) echo "unsupported dependency ecosystem: $ecosystem" >&2; exit 1 ;;
	esac
done

osv-scanner scan source \
	--config osv-scanner.toml \
	--format=vertical \
	--verbosity=error \
	"${lockfiles[@]}"
