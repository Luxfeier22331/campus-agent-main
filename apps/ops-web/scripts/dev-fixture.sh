#!/usr/bin/env bash
set -eo pipefail

set -a
# shellcheck source=/dev/null
. ./.env.local
set +a
exec node --experimental-strip-types test/fixtures/internal-portal-automation-server.ts --port "$PORT" "$@"
