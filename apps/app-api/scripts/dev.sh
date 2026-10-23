#!/usr/bin/env bash
set -eo pipefail

set -a
# shellcheck source=/dev/null
. ./.env.local
# shellcheck source=/dev/null
. ./.dev.vars.local
set +a
export WRANGLER_DISABLE_EXPERIMENTAL_WARNING=1
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-../../.wrangler-home}"
exec wrangler dev -e local --name app-api-local --ip 127.0.0.1 --port "$PORT" --env-file .dev.vars.local --var "CLUSTER_PRIVATE_BASE_URL:$CLUSTER_PRIVATE_BASE_URL" "$@"
