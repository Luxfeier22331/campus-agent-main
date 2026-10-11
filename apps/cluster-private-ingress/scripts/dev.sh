#!/usr/bin/env bash
set -eo pipefail
set -a
# shellcheck source=/dev/null
. ./.env.local
set +a
exec go run ./cmd/cluster-private-ingress
