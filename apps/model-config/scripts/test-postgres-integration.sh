#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly POSTGRES_IMAGE='postgres:18-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'
readonly RYUK_IMAGE='testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0'
readonly RYUK_TAG='testcontainers/ryuk:0.14.0'

docker version --format '{{.Server.Version}}' >/dev/null

ensure_image() {
	local image="$1"
	if ! docker image inspect "${image}" >/dev/null 2>&1; then
		docker pull "${image}" >/dev/null
	fi
}

ensure_image "${POSTGRES_IMAGE}"
ensure_image "${RYUK_IMAGE}"
docker tag "${RYUK_IMAGE}" "${RYUK_TAG}"

export TESTCONTAINERS_RYUK_DISABLED=false
cd "$app_root"
go test -count=1 -p=1 -tags=postgres_integration ./internal/modelconfig ./internal/httpapi
