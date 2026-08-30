#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
collector_image="otel/opentelemetry-collector-contrib:0.158.0@sha256:c5918f78992ee73b0d6f0e599423ac5ec52dd5d9726733114d6eca53d5a32ed5"

docker_args=(
  --rm
  --network=none
  --read-only
  --cap-drop=ALL
  --security-opt=no-new-privileges
  -e LANGFUSE_PUBLIC_KEY=pk-lf-ci-validation
  -e LANGFUSE_SECRET_KEY=sk-lf-ci-validation
  -e OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.example.invalid/api/public/otel
)
if [[ -n "${CI_DOCKER_CGROUP_PARENT:-}" ]]; then
  docker_args+=(
    --cgroup-parent "$CI_DOCKER_CGROUP_PARENT"
    --cpus "${CI_DOCKER_CPUS:-2}"
    --memory "${CI_DOCKER_MEMORY:-2g}"
    --memory-swap "${CI_DOCKER_MEMORY:-2g}"
    --pids-limit "${CI_DOCKER_PIDS_LIMIT:-1024}"
  )
fi

validate_config() {
  local config="$1"
  shift
  echo "Validating ${config#"$repo_root/"}"
  docker run "${docker_args[@]}" \
    --mount "type=bind,src=$config,dst=/etc/otelcol-contrib/config.yaml,readonly" \
    "$collector_image" \
    validate --config=/etc/otelcol-contrib/config.yaml "$@"
}

validate_config "$repo_root/infra/otel/collector-local-debug.yaml"
validate_config "$repo_root/infra/otel/collector-local-prodlike.yaml"
