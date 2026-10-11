#!/usr/bin/env bash
set -eo pipefail
set -a
# shellcheck source=/dev/null
. ./.env.local
set +a
mkdir -p ../../var/dev/bin
go build -o ../../var/dev/bin/memory-api ./cmd/memory-api
go build -o ../../var/dev/bin/memory-worker ./cmd/memory-worker
../../var/dev/bin/memory-api &
api_pid=$!
MEMORY_PORT="${MEMORY_WORKER_PORT:?run pnpm dev:init}" ../../var/dev/bin/memory-worker &
worker_pid=$!
cleanup() {
 trap '' INT TERM
 kill -TERM "$api_pid" "$worker_pid" 2>/dev/null || true
 wait "$api_pid" "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
wait -n "$api_pid" "$worker_pid"
