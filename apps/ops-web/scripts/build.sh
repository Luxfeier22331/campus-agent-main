#!/usr/bin/env bash
set -eo pipefail

if [[ -n "${VITE_TLDRAW_LICENSE_KEY//[[:space:]]/}" ]]; then
	echo "tldraw license key: configured"
else
	echo "tldraw license key: not configured (development mode)"
fi

vite build
vite build --ssr src/server/node.ts --outDir dist-server
vite build --config vite.ops.config.ts "$@"
