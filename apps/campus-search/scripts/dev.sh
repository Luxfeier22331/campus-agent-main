#!/usr/bin/env bash
set -eo pipefail
set -a
# shellcheck source=/dev/null
. ./.env.local
set +a
mkdir -p ../../var/dev/bin
go build -o ../../var/dev/bin/campus-search-service ./cmd/campus-search-service
exec ../../var/dev/bin/campus-search-service
