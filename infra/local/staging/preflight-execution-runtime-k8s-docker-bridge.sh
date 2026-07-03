#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

bind_ip="${EXECUTION_CONTROL_K8S_HOST_BIND_IP:-10.42.0.1}"
proxy_bind_ip="${EXECUTION_CONTROL_K8S_PROXY_HOST_BIND_IP:-172.20.0.1}"
overlay="${EXECUTION_CONTROL_K8S_OVERLAY:-${execution_control_staging_repo_root}/infra/k8s/execution-runtime/overlays/nc-arm-6c-staging}"

require_command() {
execution_control_staging_require_command "$1" >/dev/null
}

require_command kubectl
require_command ss

execution_control_staging_load_env

if [[ "${EXECUTION_CONTROL_RUNTIME_RELEASE:-}" != execution-control@* ]]; then
  echo "EXECUTION_CONTROL_RUNTIME_RELEASE must be set to a real execution-control@<sha> value before K8s apply." >&2
  exit 1
fi
if [[ "${EXECUTION_CONTROL_RUNTIME_RELEASE}" == *"0000000"* || "${EXECUTION_CONTROL_RUNTIME_RELEASE}" == *"__"* ]]; then
  echo "EXECUTION_CONTROL_RUNTIME_RELEASE must not be a placeholder: ${EXECUTION_CONTROL_RUNTIME_RELEASE}" >&2
  exit 1
fi

if ! ip -4 addr show | grep -Fq "inet ${bind_ip}/"; then
  echo "K8s host bind IP is not present on this host: ${bind_ip}" >&2
  exit 1
fi
if ! ip -4 addr show | grep -Fq "inet ${proxy_bind_ip}/"; then
  echo "K8s proxy host bind IP is not present on this host: ${proxy_bind_ip}" >&2
  exit 1
fi

if ! kubectl kustomize "${overlay}" >/dev/null; then
  echo "K8s execution-runtime overlay does not render: ${overlay}" >&2
  exit 1
fi

required_ports=(5432 6333 7233 8888 4318)
for port in "${required_ports[@]}"; do
  if ! ss -ltn "sport = :${port}" | awk 'NR > 1 {print $4}' | grep -Fxq "${bind_ip}:${port}"; then
    echo "Required Docker dependency is not listening on ${bind_ip}:${port}" >&2
    exit 1
  fi
done

for port in 5432 6333 7233 8888; do
  if ss -ltn "sport = :${port}" | awk 'NR > 1 {print $4}' | grep -Eq "^(0\\.0\\.0\\.0|\\[::\\]):${port}$"; then
    echo "Docker dependency port must not be exposed on all interfaces: ${port}" >&2
    exit 1
  fi
done

echo "execution-runtime K8s/Docker bridge preflight passed."
