#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="$repo_root/infra/otel/collector.env.example"
collector_image="otel/opentelemetry-collector-contrib:0.127.0@sha256:e94cfd92357aa21f4101dda3c0c01f90e6f24115ba91b263c4d09fed7911ae68"

conftest verify --policy "$repo_root/infra/policies"
conftest test \
  --namespace campus.otel.config \
  --policy "$repo_root/infra/policies" \
  --parser yaml \
  "$repo_root/infra/otel/collector-local-debug.yaml" \
  "$repo_root/infra/otel/collector-local-prodlike.yaml"

docker_args=(
  --rm
  --network=none
  --read-only
  --cap-drop=ALL
  --security-opt=no-new-privileges
  --env-file "$env_file"
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
