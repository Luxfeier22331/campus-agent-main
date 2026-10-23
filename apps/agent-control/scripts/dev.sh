#!/usr/bin/env bash
set -eo pipefail
set -a
if [[ -f ./.env.local ]]; then
  # shellcheck source=/dev/null
  . ./.env.local
fi
set +a
mkdir -p ../../var/dev/bin
go build -o ../../var/dev/bin/agent-control ./cmd/agent-control
exec ../../var/dev/bin/agent-control
