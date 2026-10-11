#!/usr/bin/env bash
set -eo pipefail
node --env-file-if-exists=.env.local --experimental-strip-types --network-family-autoselection-attempt-timeout=2000 src/server.ts &
api_pid=$!
node --env-file-if-exists=.env.local --network-family-autoselection-attempt-timeout=2000 --import=tsx src/worker.ts &
worker_pid=$!
cleanup() {
 trap '' INT TERM
 kill -TERM "$api_pid" "$worker_pid" 2>/dev/null || true
 wait "$api_pid" "$worker_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
wait -n "$api_pid" "$worker_pid"
