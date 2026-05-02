#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
worker_id="${INGESTION_ON_DEMAND_OFFICIAL_WEB_RELEASE_TASK_WORKER_ID:-official-web-release-task-runner}"
lease_seconds="${INGESTION_ON_DEMAND_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS:-300}"
work_dir="${INGESTION_ON_DEMAND_OFFICIAL_WEB_RELEASE_TASK_WORK_DIR:-${INGESTION_WORKER_OFFICIAL_WEB_RELEASE_TASK_WORK_DIR:-./var/official-web-release-tasks}}"
task_types="${INGESTION_ON_DEMAND_OFFICIAL_WEB_RELEASE_TASK_TYPES:-}"
declarations_path="${INGESTION_ON_DEMAND_OFFICIAL_WEB_RELEASE_TASK_DECLARATIONS_PATH:-}"
reset_index="${INGESTION_ON_DEMAND_OFFICIAL_WEB_RELEASE_TASK_RESET_INDEX:-0}"

args=(
  --worker-id "${worker_id}"
  --lease-seconds "${lease_seconds}"
  --work-dir "${work_dir}"
)

if [[ -n "${declarations_path}" ]]; then
  args+=(--declarations-path "${declarations_path}")
fi
if [[ "${reset_index}" == "1" || "${reset_index}" == "true" ]]; then
  args+=(--reset-index)
fi
if [[ -n "${task_types}" ]]; then
  IFS=',' read -ra task_type_items <<< "${task_types}"
  for task_type in "${task_type_items[@]}"; do
    task_type="${task_type//[[:space:]]/}"
    if [[ -n "${task_type}" ]]; then
      args+=(--task-type "${task_type}")
    fi
  done
fi

exec "${script_dir}/run-ingestion-worker-batch.sh" official-web-release-tasks "${args[@]}"
