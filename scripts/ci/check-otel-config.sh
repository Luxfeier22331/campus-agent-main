#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
agent_config="$repo_root/infra/otel/collector-agent-staging-template.yaml"
env_file="$repo_root/infra/otel/collector.env.example"
collector_image="otel/opentelemetry-collector-contrib:0.127.0@sha256:e94cfd92357aa21f4101dda3c0c01f90e6f24115ba91b263c4d09fed7911ae68"

"$repo_root/scripts/ci/check-otel-trusted-sanitizer.sh"

if [[ "$(rg -c '^[[:space:]]+auth_type: serviceAccount$' "$agent_config" || true)" != 2 ]]; then
  echo "Collector Agent production config must use serviceAccount auth for kubeletstats and k8sattributes." >&2
  exit 1
fi
rg -Fq '    ca_file: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt' "$agent_config" || {
  echo "Collector Agent production config must verify kubelet TLS with the service account CA." >&2
  exit 1
}
rg -Fq '    insecure_skip_verify: false' "$agent_config" || {
  echo "Collector Agent production config must keep kubelet TLS verification enabled." >&2
  exit 1
}

docker_args=(
  --rm
  --network=none
  --read-only
  --cap-drop=ALL
  --security-opt=no-new-privileges
  --env-file "$env_file"
  -e K8S_NODE_NAME=127.0.0.1
  -e LANGFUSE_PUBLIC_KEY=pk-lf-ci-validation
  -e LANGFUSE_SECRET_KEY=sk-lf-ci-validation
  -e OTEL_COLLECTOR_AXIOM_INGEST_TOKEN=xaat-ci-validation
  -e OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.example.invalid/api/public/otel
)

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
validate_config "$repo_root/infra/otel/collector-staging-template.yaml"
validate_config "$agent_config" \
  --set=receivers::kubeletstats::auth_type=none \
  --set=receivers::kubeletstats::ca_file= \
  --set=receivers::kubeletstats::insecure_skip_verify=true \
  --set=processors::k8sattributes::auth_type=none
