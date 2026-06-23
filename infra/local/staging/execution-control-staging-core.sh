#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

execution_control_staging_ensure_runtime_dirs() {
  mkdir -p "${execution_control_staging_log_dir}"
}

execution_control_staging_require_deploy_checkout_clean() {
  local git_bin
  local actual_head
  local expected_ref="${EXECUTION_CONTROL_STAGING_EXPECTED_REF:-}"
  local expected_sha="${EXECUTION_CONTROL_STAGING_EXPECTED_SHA:-}"
  local untracked_allow_regex="${EXECUTION_CONTROL_STAGING_ALLOWED_UNTRACKED_REGEX:-^\\.tmp/}"
  local tracked_status
  local untracked_status
  local untracked_offenders
  local repo_local_runtime_artifact
  local repo_local_runtime_artifacts=(
    ".venv"
    "node_modules"
  )
  local repo_local_secret_file
  local repo_local_secret_files=(
    ".env"
    ".env.staging.local"
    "apps/app-api/.dev.vars"
  )

  git_bin="$(execution_control_staging_require_command git)"
  (
    cd "${execution_control_staging_repo_root}" || exit
    if ! "${git_bin}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      echo "Deploy checkout is not a git worktree: ${execution_control_staging_repo_root}" >&2
      exit 1
    fi

    if [[ -z "${expected_sha}" ]]; then
      echo "EXECUTION_CONTROL_STAGING_EXPECTED_SHA is required for pinned staging deploy checkout." >&2
      exit 1
    fi

    actual_head="$("${git_bin}" rev-parse HEAD)"
    if [[ -n "${expected_sha}" && "${actual_head}" != "${expected_sha}" ]]; then
      echo "Deploy checkout HEAD does not match EXECUTION_CONTROL_STAGING_EXPECTED_SHA: expected ${expected_sha}, got ${actual_head}" >&2
      exit 1
    fi

    if [[ -n "${expected_ref}" ]]; then
      if ! "${git_bin}" merge-base --is-ancestor "${actual_head}" "${expected_ref}" >/dev/null 2>&1 &&
        [[ "$("${git_bin}" rev-parse --abbrev-ref HEAD)" != "${expected_ref}" ]]; then
        echo "Deploy checkout is not on expected ref ${expected_ref} at ${actual_head}" >&2
        exit 1
      fi
    fi

    tracked_status="$("${git_bin}" status --porcelain --untracked-files=no)"
    if [[ -n "${tracked_status}" ]]; then
      echo "Deploy checkout has tracked modifications; quarantine or rebuild instead of starting from a dirty worktree." >&2
      echo "${tracked_status}" >&2
      exit 1
    fi

    for repo_local_secret_file in "${repo_local_secret_files[@]}"; do
      if [[ -e "${repo_local_secret_file}" ]]; then
        echo "Deploy checkout contains repo-local runtime secret file: ${repo_local_secret_file}. Move staging secrets to ${execution_control_staging_env_file} or Docker/ops-owned secrets." >&2
        exit 1
      fi
    done

    for repo_local_runtime_artifact in "${repo_local_runtime_artifacts[@]}"; do
      if [[ -e "${repo_local_runtime_artifact}" ]]; then
        echo "Deploy checkout contains repo-local runtime artifact: ${repo_local_runtime_artifact}. Move runtime tool state to ${execution_control_staging_runtime_dir} or another ops-owned path outside source truth." >&2
        exit 1
      fi
    done

    untracked_status="$("${git_bin}" ls-files --others --exclude-standard)"
    untracked_offenders="$(
      while IFS= read -r untracked_path; do
        if [[ -n "${untracked_path}" && ! "${untracked_path}" =~ ${untracked_allow_regex} ]]; then
          printf '%s\n' "${untracked_path}"
        fi
      done <<<"${untracked_status}"
    )"
    if [[ -n "${untracked_offenders}" ]]; then
      echo "Deploy checkout has unexpected untracked files; runtime artifacts must stay outside the repo or match EXECUTION_CONTROL_STAGING_ALLOWED_UNTRACKED_REGEX." >&2
      echo "${untracked_offenders}" >&2
      exit 1
    fi
  )
}

execution_control_staging_acquire_lock() {
  local wait_seconds="${1:-${execution_control_staging_lock_wait_seconds}}"

  exec 9>"${execution_control_staging_lock_file}"
  if ! flock -w "${wait_seconds}" 9; then
    echo "Timed out waiting for ${execution_control_staging_lock_file}; another staging lifecycle command is still active." >&2
    return 1
  fi
}

execution_control_staging_require_command() {
  local command_name="$1"
  local resolved

  resolved="$(command -v "${command_name}" || true)"
  if [[ -z "${resolved}" ]]; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi

  printf '%s\n' "${resolved}"
}

execution_control_staging_read_pid() {
  local pid_file="$1"

  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  tr -d '[:space:]' <"${pid_file}"
}

execution_control_staging_pid_is_running() {
  local pid_file="$1"
  local pid
  local kill_output

  pid="$(execution_control_staging_read_pid "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi

  kill_output="$(kill -0 "${pid}" 2>&1 || true)"
  if [[ "${kill_output}" == *"Operation not permitted"* ]]; then
    return 0
  fi

  return 1
}

execution_control_staging_cleanup_stale_pidfile() {
  local pid_file="$1"

  if [[ -f "${pid_file}" ]] && ! execution_control_staging_pid_is_running "${pid_file}"; then
    rm -f "${pid_file}"
  fi
}

execution_control_staging_adopt_existing_process() {
  local label="$1"
  local pid_file="$2"
  local match_pattern="$3"
  local -a matched_pids

  execution_control_staging_cleanup_stale_pidfile "${pid_file}"
  if execution_control_staging_pid_is_running "${pid_file}"; then
    return 0
  fi

  mapfile -t matched_pids < <(pgrep -f -- "${match_pattern}" || true)
  if (( ${#matched_pids[@]} == 1 )); then
    printf '%s\n' "${matched_pids[0]}" >"${pid_file}"
    echo "${label}: adopted existing pid ${matched_pids[0]}"
    return 0
  fi

  if (( ${#matched_pids[@]} > 1 )); then
    echo "${label}: multiple matching processes found (${matched_pids[*]}), refusing automatic adoption" >&2
  fi

  return 1
}

execution_control_staging_wait_for_http_ok() {
  local url="$1"
  local attempts="${2:-30}"
  local sleep_seconds="${3:-1}"
  local header_value="${4:-}"
  local header_kind="${5:-}"
  local attempt
  local status_code
  local -a curl_args

  curl_args=(-sS -o /dev/null -w "%{http_code}")
  execution_control_staging_append_probe_auth_header curl_args "${header_value}" "${header_kind}"
  curl_args+=("${url}")

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    status_code="$(curl "${curl_args[@]}" || true)"
    if [[ "${status_code}" == "200" ]]; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  echo "Timed out waiting for ${url} to return 200." >&2
  return 1
}

execution_control_staging_probe_http_url() {
  local url="$1"
  local body_file="$2"
  local use_noproxy="${3:-0}"
  local header_value="${4:-}"
  local header_kind="${5:-}"
  local -a curl_command

  curl_command=(curl -sS -o "${body_file}" -w "%{http_code}")
  if [[ "${use_noproxy}" == "1" ]]; then
    curl_command+=(--noproxy '*')
  fi
  execution_control_staging_append_probe_auth_header curl_command "${header_value}" "${header_kind}"
  curl_command+=("${url}")

  "${curl_command[@]}" || true
}

execution_control_staging_probe_json_path_equals() {
  local body_file="$1"
  local path="$2"
  local expected_json="$3"
  local node_bin

  node_bin="$(execution_control_staging_require_command node)"
  "${node_bin}" - "${body_file}" "${path}" "${expected_json}" <<'NODE'
const fs = require("node:fs");
const [bodyPath, path, expectedJson] = process.argv.slice(2);
let payload;
try {
  payload = JSON.parse(fs.readFileSync(bodyPath, "utf8"));
} catch {
  process.exit(1);
}
let current = payload;
for (const segment of path.split(".")) {
  if (!segment) {
    process.exit(1);
  }
  if (!current || typeof current !== "object" || !(segment in current)) {
    process.exit(1);
  }
  current = current[segment];
}
if (JSON.stringify(current) !== JSON.stringify(JSON.parse(expectedJson))) {
  process.exit(1);
}
NODE
}

execution_control_staging_append_probe_auth_header() {
  local -n curl_args_ref="$1"
  local header_value="${2:-}"
  local header_kind="${3:-}"

  if [[ -z "${header_value}" ]]; then
    return 0
  fi

  case "${header_kind}" in
    authorization)
      curl_args_ref+=(-H "authorization: Bearer ${header_value}")
      ;;
    x-worker-origin-auth)
      curl_args_ref+=(-H "x-worker-origin-auth: ${header_value}")
      ;;
    "")
      curl_args_ref+=(-H "authorization: Bearer ${header_value}")
      ;;
    *)
      echo "Unsupported probe auth header kind: ${header_kind}" >&2
      return 1
      ;;
  esac
}

execution_control_staging_rotate_log_file_if_needed() {
  local log_file="$1"
  local max_bytes="${2:-${execution_control_staging_log_rotate_max_bytes}}"
  local keep_count="${3:-${execution_control_staging_log_rotate_keep_count}}"
  local file_size
  local backup_index
  local backup_path
  local backup_suffix
  local -a existing_backups

  if [[ ! -f "${log_file}" ]]; then
    return 0
  fi

  file_size="$(wc -c <"${log_file}")"
  if (( file_size <= max_bytes )); then
    return 0
  fi

  shopt -s nullglob
  existing_backups=("${log_file}".*)
  shopt -u nullglob
  for backup_path in "${existing_backups[@]}"; do
    backup_suffix="${backup_path##*.}"
    if [[ "${backup_suffix}" =~ ^[0-9]+$ ]] && (( backup_suffix > keep_count )); then
      rm -f "${backup_path}"
    fi
  done

  rm -f "${log_file}.${keep_count}"
  for ((backup_index = keep_count - 1; backup_index >= 1; backup_index -= 1)); do
    if [[ -f "${log_file}.${backup_index}" ]]; then
      mv "${log_file}.${backup_index}" "${log_file}.$((backup_index + 1))"
    fi
  done

  cp "${log_file}" "${log_file}.1"
  : >"${log_file}"
}

execution_control_staging_rotate_logs_if_needed() {
  execution_control_staging_rotate_log_file_if_needed "${execution_control_staging_execution_control_log_file}"
  execution_control_staging_rotate_log_file_if_needed "${execution_control_staging_otel_collector_log_file}"
}

execution_control_staging_kill_managed_process() {
  local pid="$1"
  local signal="${2:-TERM}"

  if kill "-${signal}" -- "-${pid}" 2>/dev/null; then
    return 0
  fi

  kill "-${signal}" "${pid}" 2>/dev/null
}

execution_control_staging_print_process_status() {
  local label="$1"
  local pid_file="$2"

  execution_control_staging_cleanup_stale_pidfile "${pid_file}"
  if execution_control_staging_pid_is_running "${pid_file}"; then
    echo "${label}: running (pid $(execution_control_staging_read_pid "${pid_file}"))"
    return 0
  fi

  echo "${label}: stopped"
  return 1
}

execution_control_staging_compose() {
  local compose_args=()
  local compose_file
  local compose_files=()
  local docker_bin
  local worker_shared_secret

  IFS=':' read -r -a compose_files <<<"${execution_control_staging_compose_files}"
  for compose_file in "${compose_files[@]}"; do
    compose_args+=(-f "${compose_file}")
  done

  docker_bin="$(execution_control_staging_require_command docker)"
  worker_shared_secret="${EXECUTION_CONTROL_SHARED_SECRET:?EXECUTION_CONTROL_SHARED_SECRET is required}"

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${execution_control_staging_compose_project_name}" \
    EXECUTION_CONTROL_HOST_PORT="${execution_control_staging_host}:${execution_control_staging_port}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    EXECUTION_CONTROL_RUNTIME_PROFILE=staging \
    API_AUTH_MODE=trusted-worker \
    API_WORKER_SHARED_SECRET="${worker_shared_secret}" \
    CAMPUS_SHARED_POSTGRES_URL="${CAMPUS_SHARED_POSTGRES_DOCKER_URL:?CAMPUS_SHARED_POSTGRES_DOCKER_URL is required}" \
    DOCUMENT_REGISTRY_DATABASE_URL="${DOCUMENT_REGISTRY_DOCKER_DATABASE_URL:?DOCUMENT_REGISTRY_DOCKER_DATABASE_URL is required}" \
    RAW_ASSET_REGISTRY_DATABASE_URL="${RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL:?RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL is required}" \
    CAMPUS_SHARED_POSTGRES_OPERATOR_URL="${CAMPUS_SHARED_POSTGRES_OPERATOR_DOCKER_URL:-${CAMPUS_SHARED_POSTGRES_DOCKER_URL}}" \
    DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL="${DOCUMENT_REGISTRY_OPERATOR_DOCKER_DATABASE_URL:-${DOCUMENT_REGISTRY_DOCKER_DATABASE_URL}}" \
    RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL="${RAW_ASSET_REGISTRY_OPERATOR_DOCKER_DATABASE_URL:-${RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL}}" \
    OBJECT_STORE_ENDPOINT="${OBJECT_STORE_DOCKER_ENDPOINT:?OBJECT_STORE_DOCKER_ENDPOINT is required}" \
    QDRANT_URL="${QDRANT_DOCKER_URL:?QDRANT_DOCKER_URL is required}" \
    QDRANT_QUERY_API_KEY="${QDRANT_QUERY_API_KEY:?QDRANT_QUERY_API_KEY is required}" \
    QDRANT_TLS_CA_CERT_PATH="${QDRANT_TLS_CA_CERT_PATH:?QDRANT_TLS_CA_CERT_PATH is required}" \
    QDRANT_TLS_DIR="${QDRANT_TLS_DIR:-$(dirname "${QDRANT_TLS_CA_CERT_PATH:?QDRANT_TLS_CA_CERT_PATH is required}")}" \
    EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL="${EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL:?EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL is required}" \
    EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL="${EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL:?EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL is required}" \
    EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET="${EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET:?EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET is required}" \
    EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS="${EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS:-30000}" \
    AGENT_RUNTIME_SHARED_SECRET="${AGENT_RUNTIME_SHARED_SECRET:?AGENT_RUNTIME_SHARED_SECRET is required}" \
    AGENT_RUNTIME_TOOL_CATALOG_PATH="${AGENT_RUNTIME_TOOL_CATALOG_PATH:-configs/runtime/tool-catalog.v1.json}" \
    AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL="${AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL:?AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL is required}" \
    AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET="${AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET:?AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET is required}" \
    EXECUTION_CONTROL_TEMPORAL_ADDRESS="${EXECUTION_CONTROL_TEMPORAL_ADDRESS:?EXECUTION_CONTROL_TEMPORAL_ADDRESS is required}" \
    EXECUTION_CONTROL_TEMPORAL_NAMESPACE="${EXECUTION_CONTROL_TEMPORAL_NAMESPACE:?EXECUTION_CONTROL_TEMPORAL_NAMESPACE is required}" \
    EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE="${EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE:-campus-agent.workflow}" \
    EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY is required}" \
	    EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY is required}" \
	    EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY is required}" \
	    EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY is required}" \
	    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY is required}" \
	    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY is required}" \
	    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY is required}" \
    EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY is required}" \
    EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY is required}" \
    EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY is required}" \
    EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY is required}" \
    EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT="${EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT:?EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT is required}" \
    EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS="${EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS:-5000}" \
    TEMPORAL_POSTGRES_PASSWORD="${TEMPORAL_POSTGRES_PASSWORD:?TEMPORAL_POSTGRES_PASSWORD is required}" \
    HINDSIGHT_POSTGRES_PASSWORD="${HINDSIGHT_POSTGRES_PASSWORD:?HINDSIGHT_POSTGRES_PASSWORD is required}" \
    "${docker_bin}" compose --env-file "${execution_control_staging_env_file}" "${compose_args[@]}" "$@"
  )
}

execution_control_staging_compose_running_services() {
  execution_control_staging_compose ps --services --status running
}

execution_control_staging_compose_project_running() {
  local services
  services="$(execution_control_staging_compose_running_services 2>/dev/null || true)"
  [[ "${services}" == *"otel-collector"* ]] &&
    [[ "${services}" == *"execution-control"* ]] &&
	    [[ "${services}" == *"workflow-worker"* ]] &&
	    [[ "${services}" == *"activity-worker-context"* ]] &&
	    [[ "${services}" == *"agent-runtime"* ]] &&
	    [[ "${services}" == *"activity-worker-agent"* ]] &&
	    [[ "${services}" == *"activity-worker-knowledge-plan"* ]] &&
	    [[ "${services}" == *"activity-worker-knowledge-retrieval"* ]] &&
	    [[ "${services}" == *"activity-worker-knowledge-synthesis"* ]] &&
    [[ "${services}" == *"activity-worker-campus-services"* ]] &&
    [[ "${services}" == *"activity-worker-notice"* ]] &&
    [[ "${services}" == *"activity-worker-navigation"* ]] &&
    [[ "${services}" == *"activity-worker-finalization"* ]]
}

execution_control_staging_run_projection_schema_command() {
  local mode="$1"
  local evidence_path="$2"
  local docker_bin
  local container_evidence_path

  docker_bin="$(execution_control_staging_require_command docker)"
  case "${evidence_path}" in
    "${execution_control_staging_repo_root}"/*)
      container_evidence_path="/workspace/${evidence_path#"${execution_control_staging_repo_root}/"}"
      ;;
    *)
      echo "Run projection store schema evidence path must stay under repo root: ${evidence_path}" >&2
      return 1
      ;;
  esac
  (
    cd "${execution_control_staging_repo_root}" || exit
    "${docker_bin}" run --rm \
      --network "${execution_control_staging_data_plane_network}" \
      -v "${execution_control_staging_repo_root}:/workspace" \
      -w /workspace/apps/execution-control \
      -e GOCACHE=/workspace/.tmp/go-cache \
      -e GOMODCACHE=/workspace/.tmp/go-mod-cache \
      golang:1.26.2-bookworm \
      go run ./cmd/run-projection-schema \
        --mode "${mode}" \
        --database-url "${EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL:?EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL is required}" \
        --evidence-path "${container_evidence_path}"
  )
}

execution_control_staging_ensure_run_projection_store_schema() {
  local evidence_dir="${execution_control_staging_runtime_dir}/evidence"
  mkdir -p "${evidence_dir}"

  execution_control_staging_run_projection_schema_command \
    install \
    "${evidence_dir}/run-projection-schema-install.json"
  execution_control_staging_run_projection_schema_command \
    check \
    "${evidence_dir}/run-projection-schema-check.json"
}

execution_control_staging_reconcile_hindsight_postgres_password() {
  local hindsight_password="${HINDSIGHT_POSTGRES_PASSWORD:?HINDSIGHT_POSTGRES_PASSWORD is required}"

  printf "%s\n" "ALTER ROLE hindsight PASSWORD :'password';" |
    execution_control_staging_compose exec \
      -T \
      hindsight-postgres \
      psql -U hindsight -d hindsight -v ON_ERROR_STOP=1 -v password="${hindsight_password}"
  if execution_control_staging_compose ps --services --status running | grep -Fxq "hindsight-api"; then
    execution_control_staging_compose restart hindsight-api
  fi
}

execution_control_staging_personal_memory_runtime_command() {
  local mode="$1"
  local evidence_path="$2"
  local docker_bin
  local container_evidence_path

  docker_bin="$(execution_control_staging_require_command docker)"
  case "${evidence_path}" in
    "${execution_control_staging_repo_root}"/*)
      container_evidence_path="/workspace/${evidence_path#"${execution_control_staging_repo_root}/"}"
      ;;
    *)
      echo "Personal memory runtime evidence path must stay under repo root: ${evidence_path}" >&2
      return 1
      ;;
  esac
  (
    cd "${execution_control_staging_repo_root}" || exit
    "${docker_bin}" run --rm \
      --network "${EXECUTION_CONTROL_RUNTIME_INTERNAL_NETWORK:-campus-execution-control-runtime}" \
      -v "${execution_control_staging_repo_root}:/workspace" \
      -w /workspace/apps/execution-control \
      -e GOCACHE=/workspace/.tmp/go-cache \
      -e GOMODCACHE=/workspace/.tmp/go-mod-cache \
      -e EXECUTION_CONTROL_RUNTIME_PROFILE=staging \
      -e EXECUTION_CONTROL_RUNTIME_RELEASE="${EXECUTION_CONTROL_RUNTIME_RELEASE:?EXECUTION_CONTROL_RUNTIME_RELEASE is required}" \
      -e EXECUTION_CONTROL_RUNTIME_CONFIG_PATH="/workspace/configs/runtime/execution-control/runtime-profile.staging.json" \
      -e EXECUTION_CONTROL_METRICS_BEARER_TOKEN="${EXECUTION_CONTROL_METRICS_BEARER_TOKEN:?EXECUTION_CONTROL_METRICS_BEARER_TOKEN is required}" \
      -e EXECUTION_CONTROL_TEMPORAL_ADDRESS="${EXECUTION_CONTROL_TEMPORAL_ADDRESS:?EXECUTION_CONTROL_TEMPORAL_ADDRESS is required}" \
      -e EXECUTION_CONTROL_TEMPORAL_NAMESPACE="${EXECUTION_CONTROL_TEMPORAL_NAMESPACE:?EXECUTION_CONTROL_TEMPORAL_NAMESPACE is required}" \
      -e EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY="${EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY:?EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY is required}" \
      -e EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT="${EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT:?EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT is required}" \
      -e PERSONAL_MEMORY_BASE_URL="${PERSONAL_MEMORY_BASE_URL}" \
      -e PERSONAL_MEMORY_API_SECRET="${PERSONAL_MEMORY_API_SECRET}" \
      -e PERSONAL_MEMORY_OWNER_SALT="${PERSONAL_MEMORY_OWNER_SALT}" \
      golang:1.26.2-bookworm \
      go run ./cmd/personal-memory-runtime \
        --mode "${mode}" \
        --evidence-path "${container_evidence_path}"
  )
}

execution_control_staging_ensure_personal_memory_runtime() {
  local evidence_dir="${execution_control_staging_runtime_dir}/evidence"
  mkdir -p "${evidence_dir}"

  execution_control_staging_personal_memory_runtime_command \
    install \
    "${evidence_dir}/personal-memory-runtime-install.json"
  execution_control_staging_personal_memory_runtime_command \
    check \
    "${evidence_dir}/personal-memory-runtime-check.json"
}

execution_control_staging_temporal_namespace_setup() {
  execution_control_staging_compose up temporal-namespace-setup
}

execution_control_staging_remove_ops_proof_containers() {
  local ops_proof_service
  local ops_proof_services=(
    "temporal-task-queue-sampler"
    "worker-autoscaler"
  )

  for ops_proof_service in "${ops_proof_services[@]}"; do
    execution_control_staging_compose --profile ops-proof rm -f -s "${ops_proof_service}" >/dev/null 2>&1 || true
  done
}

execution_control_staging_run_ops_proof() {
  execution_control_staging_remove_ops_proof_containers

  echo "running execution-control ops proof: temporal task queue sampler"
  execution_control_staging_compose --profile ops-proof run --rm temporal-task-queue-sampler

  echo "running execution-control ops proof: worker autoscaler dry-run"
  EXECUTION_CONTROL_WORKER_AUTOSCALER_MODE=dry-run \
    execution_control_staging_compose --profile ops-proof run --rm worker-autoscaler

  echo "ops proof projections:"
  echo "  ${execution_control_staging_app_api_base_url%/}/api/operator/runtime/temporal-task-queues"
  echo "  ${execution_control_staging_app_api_base_url%/}/api/operator/runtime/autoscaler/decisions?limit=8"
}

execution_control_staging_resolve_uv_bin() {
  local configured_uv_bin="${EXECUTION_CONTROL_STAGING_UV_BIN:-}"
  local resolved_uv_bin
  local user_uv_bin

  if [[ -n "${configured_uv_bin}" ]]; then
    if [[ ! -x "${configured_uv_bin}" ]]; then
      echo "EXECUTION_CONTROL_STAGING_UV_BIN is not executable: ${configured_uv_bin}" >&2
      return 1
    fi
    printf '%s\n' "${configured_uv_bin}"
    return 0
  fi

  resolved_uv_bin="$(command -v uv || true)"
  if [[ -n "${resolved_uv_bin}" ]]; then
    printf '%s\n' "${resolved_uv_bin}"
    return 0
  fi

  user_uv_bin="${HOME:-}/.local/bin/uv"
  if [[ -x "${user_uv_bin}" ]]; then
    printf '%s\n' "${user_uv_bin}"
    return 0
  fi

  echo "Missing required command: uv. Set EXECUTION_CONTROL_STAGING_UV_BIN or install uv at ~/.local/bin/uv." >&2
  return 1
}

execution_control_staging_uv_run() {
  local uv_bin
  local uv_state_dir="${execution_control_staging_runtime_dir}/uv"

  uv_bin="$(execution_control_staging_resolve_uv_bin)"
  mkdir -p "${uv_state_dir}/project" "${uv_state_dir}/cache"
  (
    cd "${execution_control_staging_repo_root}" || exit
    UV_PROJECT_ENVIRONMENT="${uv_state_dir}/project/.venv" \
    UV_CACHE_DIR="${uv_state_dir}/cache" \
    "${uv_bin}" run "$@"
  )
}

execution_control_staging_run_doctor() {
  EXECUTION_CONTROL_RUNTIME_CONFIG_PATH="${execution_control_staging_repo_root}/configs/runtime/execution-control/runtime-profile.staging.json" \
    execution_control_staging_uv_run \
    --all-packages \
    python -m scripts.doctor_env execution-control --json >/dev/null
}
