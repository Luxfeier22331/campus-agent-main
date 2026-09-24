#!/usr/bin/env bash
set -eo pipefail

vite build
vite build --ssr src/server/node.ts --outDir dist-server
vite build --config vite.ops.config.ts "$@"
