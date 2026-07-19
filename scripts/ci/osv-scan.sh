#!/usr/bin/env bash
set -euo pipefail

scanner="scripts/ci/osv-scanner.sh"
if [[ "$("$scanner" --version 2>/dev/null | head -n 1 | rg -o '[0-9]+\.[0-9]+\.[0-9]+')" != "2.3.8" ]]; then
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

"$scanner" scan source \
	--config osv-scanner.toml \
	--format=vertical \
	--verbosity=error \
	"${lockfiles[@]}"
