#!/usr/bin/env bash
set -euo pipefail

if ! command -v osv-scanner >/dev/null 2>&1; then
	echo "osv-scanner v2.3.8 is required" >&2
	exit 1
fi

osv-scanner scan source \
	--config osv-scanner.toml \
	--format=vertical \
	--verbosity=error \
	--lockfile pnpm-lock.yaml \
	--lockfile uv.lock \
	--lockfile Cargo.lock \
	--lockfile apps/execution-control/go.mod
