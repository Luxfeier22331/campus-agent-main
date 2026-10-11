#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

exec osv-scanner scan source \
	--config osv-scanner.toml \
	--format=vertical \
	--verbosity=error \
	--lockfile pnpm-lock.yaml \
	--lockfile uv.lock \
	--lockfile apps/agent-control/go.mod \
	--lockfile apps/model-config/go.mod
