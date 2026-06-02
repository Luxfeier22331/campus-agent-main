#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

supervisor_api_staging_ensure_runtime_dirs() {
  mkdir -p "${supervisor_api_staging_log_dir}"
}

supervisor_api_staging_acquire_lock() {
  local wait_seconds="${1:-${supervisor_api_staging_lock_wait_seconds}}"

  exec 9>"${supervisor_api_staging_lock_file}"
  if ! flock -w "${wait_seconds}" 9; then
    echo "Timed out waiting for ${supervisor_api_staging_lock_file}; another staging lifecycle command is still active." >&2
    return 1
  fi
}

supervisor_api_staging_require_command() {
  local command_name="$1"
  local resolved

  resolved="$(command -v "${command_name}" || true)"
  if [[ -z "${resolved}" ]]; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi

  printf '%s\n' "${resolved}"
}

supervisor_api_staging_read_pid() {
  local pid_file="$1"

  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  tr -d '[:space:]' <"${pid_file}"
}

supervisor_api_staging_pid_is_running() {
  local pid_file="$1"
  local pid
  local kill_output

  pid="$(supervisor_api_staging_read_pid "${pid_file}" 2>/dev/null || true)"
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

supervisor_api_staging_cleanup_stale_pidfile() {
  local pid_file="$1"

  if [[ -f "${pid_file}" ]] && ! supervisor_api_staging_pid_is_running "${pid_file}"; then
    rm -f "${pid_file}"
  fi
}

supervisor_api_staging_adopt_existing_process() {
  local label="$1"
  local pid_file="$2"
  local match_pattern="$3"
  local -a matched_pids

  supervisor_api_staging_cleanup_stale_pidfile "${pid_file}"
  if supervisor_api_staging_pid_is_running "${pid_file}"; then
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

supervisor_api_staging_wait_for_http_ok() {
  local url="$1"
  local attempts="${2:-30}"
  local sleep_seconds="${3:-1}"
  local header_value="${4:-}"
  local header_kind="${5:-}"
  local attempt
  local status_code
  local -a curl_args

  curl_args=(-sS -o /dev/null -w "%{http_code}")
  supervisor_api_staging_append_probe_auth_header curl_args "${header_value}" "${header_kind}"
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

supervisor_api_staging_append_probe_auth_header() {
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

supervisor_api_staging_rotate_log_file_if_needed() {
  local log_file="$1"
  local max_bytes="${2:-${supervisor_api_staging_log_rotate_max_bytes}}"
  local keep_count="${3:-${supervisor_api_staging_log_rotate_keep_count}}"
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

supervisor_api_staging_rotate_logs_if_needed() {
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_cloudflared_log_file}"
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_supervisor_api_log_file}"
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_supervisor_agent_worker_log_file}"
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_otel_collector_log_file}"
}

supervisor_api_staging_kill_managed_process() {
  local pid="$1"
  local signal="${2:-TERM}"

  if kill "-${signal}" -- "-${pid}" 2>/dev/null; then
    return 0
  fi

  kill "-${signal}" "${pid}" 2>/dev/null
}

supervisor_api_staging_print_process_status() {
  local label="$1"
  local pid_file="$2"

  supervisor_api_staging_cleanup_stale_pidfile "${pid_file}"
  if supervisor_api_staging_pid_is_running "${pid_file}"; then
    echo "${label}: running (pid $(supervisor_api_staging_read_pid "${pid_file}"))"
    return 0
  fi

  echo "${label}: stopped"
  return 1
}

supervisor_api_staging_compose() {
  local docker_bin
  local worker_shared_secret
  local bridge_shared_secret
  docker_bin="$(supervisor_api_staging_require_command docker)"
  worker_shared_secret="${SUPERVISOR_API_SHARED_SECRET:?SUPERVISOR_API_SHARED_SECRET is required}"
  bridge_shared_secret="${supervisor_api_staging_bridge_shared_secret:?SUPERVISOR_AGENT_WORKER_SHARED_SECRET is required}"

  (
    cd "${supervisor_api_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${supervisor_api_staging_compose_project_name}" \
    SUPERVISOR_API_HOST_PORT="${supervisor_api_staging_port}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${supervisor_api_staging_data_plane_network}" \
    SUPERVISOR_API_RUNTIME_PROFILE=staging \
    API_AUTH_MODE=trusted-worker \
    API_WORKER_SHARED_SECRET="${worker_shared_secret}" \
    SUPERVISOR_AGENT_WORKER_SHARED_SECRET="${bridge_shared_secret}" \
    CAMPUS_SHARED_POSTGRES_URL="${CAMPUS_SHARED_POSTGRES_DOCKER_URL:?CAMPUS_SHARED_POSTGRES_DOCKER_URL is required}" \
    DOCUMENT_REGISTRY_DATABASE_URL="${DOCUMENT_REGISTRY_DOCKER_DATABASE_URL:?DOCUMENT_REGISTRY_DOCKER_DATABASE_URL is required}" \
    RAW_ASSET_REGISTRY_DATABASE_URL="${RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL:?RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL is required}" \
    CAMPUS_SHARED_POSTGRES_OPERATOR_URL="${CAMPUS_SHARED_POSTGRES_OPERATOR_DOCKER_URL:-${CAMPUS_SHARED_POSTGRES_DOCKER_URL}}" \
    DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL="${DOCUMENT_REGISTRY_OPERATOR_DOCKER_DATABASE_URL:-${DOCUMENT_REGISTRY_DOCKER_DATABASE_URL}}" \
    RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL="${RAW_ASSET_REGISTRY_OPERATOR_DOCKER_DATABASE_URL:-${RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL}}" \
    OBJECT_STORE_ENDPOINT="${OBJECT_STORE_DOCKER_ENDPOINT:?OBJECT_STORE_DOCKER_ENDPOINT is required}" \
    QDRANT_URL="${QDRANT_DOCKER_URL:?QDRANT_DOCKER_URL is required}" \
    "${docker_bin}" compose -f "${supervisor_api_staging_compose_file}" "$@"
  )
}

supervisor_api_staging_compose_running_services() {
  supervisor_api_staging_compose ps --services --status running
}

supervisor_api_staging_compose_project_running() {
  local services
  services="$(supervisor_api_staging_compose_running_services 2>/dev/null || true)"
  [[ "${services}" == *"otel-collector"* ]] && [[ "${services}" == *"supervisor-api"* ]] && [[ "${services}" == *"supervisor-agent-worker"* ]]
}

supervisor_api_staging_resolve_uv_bin() {
  local configured_uv_bin="${SUPERVISOR_API_STAGING_UV_BIN:-}"
  local resolved_uv_bin
  local user_uv_bin

  if [[ -n "${configured_uv_bin}" ]]; then
    if [[ ! -x "${configured_uv_bin}" ]]; then
      echo "SUPERVISOR_API_STAGING_UV_BIN is not executable: ${configured_uv_bin}" >&2
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

  echo "Missing required command: uv. Set SUPERVISOR_API_STAGING_UV_BIN or install uv at ~/.local/bin/uv." >&2
  return 1
}

supervisor_api_staging_run_doctor() {
  local uv_bin
  uv_bin="$(supervisor_api_staging_resolve_uv_bin)"
  (
    cd "${supervisor_api_staging_repo_root}" || exit
    "${uv_bin}" run --all-packages python -m scripts.doctor_env supervisor-api --json >/dev/null
  )
}
