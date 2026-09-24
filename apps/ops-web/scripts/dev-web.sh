#!/usr/bin/env bash
set -eo pipefail

set -a
# shellcheck source=/dev/null
. ./.env.local
set +a
exec vite --host 127.0.0.1 --port "$OPS_WEB_WEB_PORT" --strictPort "$@"
