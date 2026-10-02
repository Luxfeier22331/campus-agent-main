#!/usr/bin/env bash
set -eo pipefail

set -a
# shellcheck source=/dev/null
. ./.env.local
set +a

# Build real child binaries so signals reach the role, not a go-run wrapper.
mkdir -p ../../var/dev/bin
go build -o ../../var/dev/bin/execution-api ./cmd/execution-api
go build -o ../../var/dev/bin/execution-worker ./cmd/execution-worker
case "${1:-all}" in
  api) exec ../../var/dev/bin/execution-api ;;
  worker)
    export PORT="${EXECUTION_WORKER_PORT:?run pnpm dev:init to generate the worker port}"
    exec ../../var/dev/bin/execution-worker
    ;;
  all) ;;
  *) echo 'Usage: dev.sh [api|worker]' >&2; exit 2 ;;
esac

: "${EXECUTION_WORKER_PORT:?run pnpm dev:init to generate the worker port}"
../../var/dev/bin/execution-api &
api_pid=$!
PORT="$EXECUTION_WORKER_PORT" ../../var/dev/bin/execution-worker &
worker_pid=$!
cleanup() {
  trap '' INT TERM
  kill -TERM "$api_pid" "$worker_pid" 2>/dev/null || true
  wait "$api_pid" "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
wait -n "$api_pid" "$worker_pid"
