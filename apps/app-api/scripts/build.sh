#!/usr/bin/env bash
set -eo pipefail

rm -rf dist/worker
WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1 XDG_CONFIG_HOME=./.wrangler-home pnpm exec wrangler deploy --dry-run --outdir dist/worker --env local "$@"
