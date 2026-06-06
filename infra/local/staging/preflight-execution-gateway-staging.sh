#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-gateway-staging-common.sh
source "${script_dir}/execution-gateway-staging-common.sh"

execution_gateway_staging_preflight_bool_enabled() {
  local value="${1:-}"
  case "${value,,}" in
    1 | true | yes | y | on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

docker_bin="$(execution_gateway_staging_require_command docker)"
docker_timeout_seconds="${EXECUTION_GATEWAY_STAGING_PREFLIGHT_DOCKER_TIMEOUT_SECONDS:-10}"
registry_timeout_seconds="${EXECUTION_GATEWAY_STAGING_PREFLIGHT_REGISTRY_TIMEOUT_SECONDS:-30}"

echo "Running docker version"
if command -v timeout >/dev/null 2>&1; then
  if ! timeout "${docker_timeout_seconds}" "${docker_bin}" version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    echo "Docker daemon is not reachable within ${docker_timeout_seconds}s. Start Docker Desktop or the Docker daemon before staging build." >&2
    exit 1
  fi
elif ! "${docker_bin}" version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "Docker daemon is not reachable. Start Docker Desktop or the Docker daemon before staging build." >&2
  exit 1
fi

if command -v timeout >/dev/null 2>&1; then
  if ! timeout "${docker_timeout_seconds}" "${docker_bin}" compose version >/dev/null 2>&1; then
    echo "Docker Compose v2 is not available through the docker CLI within ${docker_timeout_seconds}s." >&2
    exit 1
  fi
elif ! "${docker_bin}" compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is not available through the docker CLI." >&2
  exit 1
fi

if [[ ! -f "${execution_gateway_staging_compose_file}" ]]; then
  echo "Missing execution runtime compose file: ${execution_gateway_staging_compose_file}" >&2
  exit 1
fi

if execution_gateway_staging_preflight_bool_enabled "${EXECUTION_GATEWAY_STAGING_PREFLIGHT_SKIP_REGISTRY:-}"; then
  echo "Skipping Docker registry preflight because EXECUTION_GATEWAY_STAGING_PREFLIGHT_SKIP_REGISTRY is enabled."
  exit 0
fi

images=(
  "golang:1.26.2-bookworm"
  "debian:bookworm-slim"
  "python:3.12-slim-bookworm"
  "ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim"
)

run_registry_check() {
  local image="$1"
  local -a command

  if execution_gateway_staging_preflight_bool_enabled "${EXECUTION_GATEWAY_STAGING_PREFLIGHT_PULL:-}"; then
    echo "Running docker pull ${image}"
    command=("${docker_bin}" pull "${image}")
  else
    echo "Running docker buildx imagetools inspect ${image}"
    command=("${docker_bin}" buildx imagetools inspect "${image}")
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "${registry_timeout_seconds}" "${command[@]}" >/dev/null
  else
    "${command[@]}" >/dev/null
  fi
}

for image in "${images[@]}"; do
  if ! run_registry_check "${image}"; then
    cat >&2 <<EOF
Docker registry preflight failed for ${image}.
This usually means Docker registry/proxy access is broken for the staging host.
Fix Docker Desktop proxy/registry access, pre-pull the required base images, or set
EXECUTION_GATEWAY_STAGING_PREFLIGHT_SKIP_REGISTRY=1 only when the images are already cached locally.
Set EXECUTION_GATEWAY_STAGING_PREFLIGHT_PULL=1 to verify with docker pull instead of buildx imagetools inspect.
EOF
    exit 1
  fi
done

echo "execution-gateway staging Docker preflight passed."
