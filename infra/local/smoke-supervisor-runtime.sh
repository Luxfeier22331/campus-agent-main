#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
start_script="${repo_root}/infra/local/start-supervisor-runtime.sh"
compose_file="${SUPERVISOR_RUNTIME_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
compose_project_name="${SUPERVISOR_RUNTIME_COMPOSE_PROJECT_NAME:-campus-supervisor-runtime-local}"
api_host_port="${SUPERVISOR_API_HOST_PORT:-18080}"
api_base_url="${SUPERVISOR_RUNTIME_SMOKE_BASE_URL:-http://127.0.0.1:${api_host_port}}"
skip_start="${SUPERVISOR_RUNTIME_SMOKE_SKIP_START:-false}"
keep_running="${SUPERVISOR_RUNTIME_SMOKE_KEEP_RUNNING:-false}"
profile="${1:-closed_gate}"
started_compose="false"
smoke_result="failed"
answer_body_path=""
healthz_status_code=""
readyz_status_code=""
metrics_status_code=""
answer_status_code=""
artifact_root="${SUPERVISOR_RUNTIME_SMOKE_ARTIFACT_DIR:-${repo_root}/.tmp/supervisor-api-local-smoke}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
artifact_dir="${artifact_root}/${timestamp}-${profile}"
artifact_healthz_path="${artifact_dir}/healthz.json"
artifact_readyz_path="${artifact_dir}/readyz.json"
artifact_metrics_path="${artifact_dir}/metrics.txt"
artifact_answer_path="${artifact_dir}/answer.json"
summary_path="${artifact_dir}/summary.json"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi
}

cleanup() {
  capture_artifacts || true
  write_summary || true
  if [[ "${started_compose}" == "true" && "${keep_running}" != "true" ]]; then
    (
      cd "${repo_root}" || exit
      COMPOSE_PROJECT_NAME="${compose_project_name}" \
        SUPERVISOR_API_HOST_PORT="${api_host_port}" \
        docker compose -f "${compose_file}" down --remove-orphans
    )
  fi
}

wait_for_http_ok() {
  local url="$1"
  local attempts="${2:-60}"
  local delay_seconds="${3:-1}"

  for _ in $(seq 1 "${attempts}"); do
    if curl -fsS "${url}" >/dev/null; then
      return 0
    fi
    sleep "${delay_seconds}"
  done

  echo "Timed out waiting for ${url}" >&2
  curl -sS -i "${url}" >&2 || true
  return 1
}

curl_metrics() {
  local args=(-fsS)
  if [[ -n "${SUPERVISOR_API_METRICS_BEARER_TOKEN:-}" ]]; then
    args+=(-H "authorization: Bearer ${SUPERVISOR_API_METRICS_BEARER_TOKEN}")
  fi
  curl "${args[@]}" "${api_base_url}/metrics" >/dev/null
}

curl_metrics_to_file() {
  local output_path="$1"
  local args=(-sS -o "${output_path}" -w "%{http_code}")
  if [[ -n "${SUPERVISOR_API_METRICS_BEARER_TOKEN:-}" ]]; then
    args+=(-H "authorization: Bearer ${SUPERVISOR_API_METRICS_BEARER_TOKEN}")
  fi
  curl "${args[@]}" "${api_base_url}/metrics" || true
}

capture_artifacts() {
  mkdir -p "${artifact_dir}"
  healthz_status_code="$(curl -sS -o "${artifact_healthz_path}" -w "%{http_code}" "${api_base_url}/healthz" || true)"
  readyz_status_code="$(curl -sS -o "${artifact_readyz_path}" -w "%{http_code}" "${api_base_url}/readyz" || true)"
  metrics_status_code="$(curl_metrics_to_file "${artifact_metrics_path}")"
}

status_json() {
  local value="$1"
  if [[ -n "${value}" ]]; then
    printf '%s' "${value}"
  else
    printf 'null'
  fi
}

write_summary() {
  mkdir -p "${artifact_dir}"
  cat >"${summary_path}" <<EOF
{
  "schema_version": "campus_supervisor_runtime_smoke.v1",
  "profile": "${profile}",
  "result": "${smoke_result}",
  "base_url": "${api_base_url}",
  "started_compose": ${started_compose},
  "keep_running": ${keep_running},
  "healthz_status_code": $(status_json "${healthz_status_code}"),
  "readyz_status_code": $(status_json "${readyz_status_code}"),
  "metrics_status_code": $(status_json "${metrics_status_code}"),
  "answer_status_code": $(status_json "${answer_status_code}"),
  "artifacts": {
    "healthz": "${artifact_healthz_path}",
    "readyz": "${artifact_readyz_path}",
    "metrics": "${artifact_metrics_path}",
    "answer": "${artifact_answer_path}",
    "answer_written": $(if [[ -f "${artifact_answer_path}" ]]; then printf 'true'; else printf 'false'; fi)
  }
}
EOF
}

seed_open_structured_projection() {
  require_command uv
  if [[ -z "${CAMPUS_SHARED_POSTGRES_URL:-}" ]]; then
    echo "open_structured smoke requires CAMPUS_SHARED_POSTGRES_URL." >&2
    return 1
  fi
  export SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339="2026-04-24T20:30:00+08:00"
  (
    cd "${repo_root}" || exit
    uv run --all-packages campus-ingestion-smoke-structured-projection-postgres \
      --release-id "supervisor-runtime-smoke" \
      --generated-at "2026-04-24T20:30:00+08:00"
  )
}

assert_terminal_gate_response() {
  local status_code
  answer_body_path="${artifact_answer_path}"
  status_code="$(
    curl -sS -o "${answer_body_path}" -w "%{http_code}" \
      -H "content-type: application/json" \
      -H "x-worker-origin-auth: ${API_WORKER_SHARED_SECRET}" \
      --data-binary @- \
      "${api_base_url}/api/v1/answer" <<'JSON'
{"user_goal":"campus shuttle schedule","request_id":"smoke-structured-runtime-closed","requested_capability":"campus_services","context":{"actor":{"user_id":"smoke-student","principal_id":"smoke-student","principal_type":"student","roles":["student"]},"authorization":{"retrieval_filter":{"entitlement_groups":[],"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}}}}
JSON
  )"
  answer_status_code="${status_code}"

  if [[ "${status_code}" != "503" ]]; then
    echo "Expected /api/v1/answer to return HTTP 503 for the closed structured runtime gate; got ${status_code}" >&2
    cat "${answer_body_path}" >&2
    return 1
  fi
  if ! grep -q '"structured_runtime_closed"' "${answer_body_path}"; then
    echo "Expected structured_runtime_closed terminal envelope." >&2
    cat "${answer_body_path}" >&2
    return 1
  fi
}

assert_open_structured_response() {
  local status_code
  answer_body_path="${artifact_answer_path}"
  status_code="$(
    curl -sS -o "${answer_body_path}" -w "%{http_code}" \
      -H "content-type: application/json" \
      -H "x-worker-origin-auth: ${API_WORKER_SHARED_SECRET}" \
      -H "x-trace-id: smoke-open-structured-trace" \
      --data-binary @- \
      "${api_base_url}/api/v1/answer" <<'JSON'
{"user_goal":"我明天早上要去丰台上课，最早的班车是几点","request_id":"smoke-open-structured","context":{"actor":{"user_id":"smoke-student","principal_id":"smoke-student","principal_type":"student","roles":["student"]},"authorization":{"retrieval_filter":{"entitlement_groups":[],"visibility_level":"public","policy_projection_version":"phase1-authorization-projection-v1"}}}}
JSON
  )"
  answer_status_code="${status_code}"

  if [[ "${status_code}" != "200" ]]; then
    echo "Expected opened structured runtime to return HTTP 200; got ${status_code}" >&2
    cat "${answer_body_path}" >&2
    return 1
  fi
  if ! grep -q '"selected_target":"campus-services-agent"' "${answer_body_path}"; then
    echo "Expected campus-services-agent direct structured response." >&2
    cat "${answer_body_path}" >&2
    return 1
  fi
  if ! grep -q '"outcome":"resolved_current"' "${answer_body_path}"; then
    echo "Expected resolved_current structured runtime result." >&2
    cat "${answer_body_path}" >&2
    return 1
  fi
}

assert_readyz_degraded() {
  local readyz_probe_path
  local status_code
  readyz_probe_path="${artifact_dir}/readyz-degraded.json"
  status_code="$(curl -sS -o "${readyz_probe_path}" -w "%{http_code}" "${api_base_url}/readyz")"
  if [[ "${status_code}" != "503" ]]; then
    echo "Expected degraded /readyz to return HTTP 503; got ${status_code}" >&2
    cat "${readyz_probe_path}" >&2
    return 1
  fi
  if ! grep -q '"degraded"' "${readyz_probe_path}"; then
    echo "Expected degraded readiness body." >&2
    cat "${readyz_probe_path}" >&2
    return 1
  fi
}

configure_common_env() {
  export API_AUTH_MODE="${API_AUTH_MODE:-trusted-worker}"
  export API_WORKER_SHARED_SECRET="${API_WORKER_SHARED_SECRET:-supervisor-api-local-placeholder}"
  export SUPERVISOR_AGENT_WORKER_SHARED_SECRET="${SUPERVISOR_AGENT_WORKER_SHARED_SECRET:-supervisor-agent-worker-local-placeholder}"
  export AGENT_RUNTIME_PROVIDER="${AGENT_RUNTIME_PROVIDER:-mock-runtime}"
  export PROMPT_RUNTIME_PROVIDER="${PROMPT_RUNTIME_PROVIDER:-mock-runtime}"
  export PROMPT_RUNTIME_MODEL="${PROMPT_RUNTIME_MODEL:-supervisor-runtime-smoke-model}"
  export PROMPT_RUNTIME_API_KEY="${PROMPT_RUNTIME_API_KEY:-supervisor-runtime-smoke-key}"
  export PROMPT_RUNTIME_BASE_URL="${PROMPT_RUNTIME_BASE_URL:-http://127.0.0.1:9/v1}"
  export PROMPT_STRICT_STRUCTURED_OUTPUTS="${PROMPT_STRICT_STRUCTURED_OUTPUTS:-true}"
}

configure_profile_env() {
  case "${profile}" in
    closed_gate)
      ;;
    bridge_semantic)
      export SUPERVISOR_API_OPEN_CAPABILITIES="${SUPERVISOR_API_OPEN_CAPABILITIES:-}"
      ;;
    open_structured)
      export SUPERVISOR_API_OPEN_CAPABILITIES=campus_services
      seed_open_structured_projection
      ;;
    readyz_degraded)
      export PROMPT_RUNTIME_API_KEY=""
      export PROMPT_RUNTIME_MODEL=""
      ;;
    *)
      echo "Unknown smoke profile: ${profile}. Expected closed_gate, bridge_semantic, open_structured, or readyz_degraded." >&2
      return 1
      ;;
  esac
}

run_profile_assertions() {
  wait_for_http_ok "${api_base_url}/healthz" 90 1
  if [[ "${profile}" == "readyz_degraded" ]]; then
    assert_readyz_degraded
    curl_metrics
    return 0
  fi
  if [[ "${profile}" == "open_structured" ]]; then
    curl -sS "${api_base_url}/readyz" >/dev/null || true
    curl_metrics
    assert_open_structured_response
    return 0
  fi
  wait_for_http_ok "${api_base_url}/readyz" 90 1
  curl_metrics
  case "${profile}" in
    closed_gate)
      assert_terminal_gate_response
      ;;
    bridge_semantic)
      assert_terminal_gate_response
      ;;
  esac
}

main() {
  require_command curl
  require_command docker

  configure_common_env
  configure_profile_env
  mkdir -p "${artifact_dir}"

  trap cleanup EXIT

  if [[ "${skip_start}" != "true" ]]; then
    "${start_script}" up -d --build
    started_compose="true"
  fi
  run_profile_assertions
  smoke_result="passed"

  echo "supervisor runtime smoke passed (${profile}): ${api_base_url}"
  echo "artifacts: ${artifact_dir}"
}

main "$@"
