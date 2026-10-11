#!/usr/bin/env bash
set -eo pipefail
exec node --env-file-if-exists=.env.local --network-family-autoselection-attempt-timeout=2000 --import=tsx src/worker.ts
