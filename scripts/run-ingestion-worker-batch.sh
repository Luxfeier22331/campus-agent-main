#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <batch-kind> [runner args...]" >&2
  exit 2
fi

batch_kind="$1"
shift

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${CAMPUS_AGENT_REPO_ROOT:-$(cd -- "${script_dir}/.." && pwd)}"
report_dir="${INGESTION_ON_DEMAND_REPORT_DIR:-.tmp/ingestion-reports}"
lock_dir="${INGESTION_ON_DEMAND_LOCK_DIR:-.tmp/ingestion-locks}"
lock_mode="${INGESTION_ON_DEMAND_LOCK_MODE:-skip}"
preflight_live="${INGESTION_ON_DEMAND_PREFLIGHT_LIVE:-0}"
python_bin="${INGESTION_ON_DEMAND_PYTHON_BIN:-}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_path="${report_dir}/${batch_kind}-${timestamp}.json"
lock_file="${lock_dir}/${batch_kind}.lock"
retention_max_age_days="${INGESTION_REPORT_RETENTION_MAX_AGE_DAYS:-14}"
retention_max_count="${INGESTION_REPORT_RETENTION_MAX_COUNT:-200}"
retention_keep_failed="${INGESTION_REPORT_RETENTION_KEEP_FAILED:-true}"

cd "${repo_root}"
mkdir -p "${report_dir}" "${lock_dir}"

if [[ -z "${python_bin}" && -x "${repo_root}/.venv/bin/python" ]]; then
  python_bin="${repo_root}/.venv/bin/python"
fi
if [[ -n "${python_bin}" && ! -x "${python_bin}" ]]; then
  echo "INGESTION_ON_DEMAND_PYTHON_BIN is not executable: ${python_bin}" >&2
  exit 2
fi

preflight_args=(
  "--batch-kind" "${batch_kind}"
  "--report-dir" "${report_dir}"
  "--lock-dir" "${lock_dir}"
)
if [[ "${preflight_live}" == "1" || "${preflight_live}" == "true" ]]; then
  preflight_args+=("--live")
fi

exec 9>"${lock_file}"
if ! flock -n 9; then
  if [[ "${lock_mode}" == "fail" ]]; then
    echo "lock is held for ${batch_kind}: ${lock_file}" >&2
    exit 1
  fi
  skipped_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  cat > "${report_path}" <<EOF
{
  "schema_version": "campus_ingestion_on_demand_batch.v1",
  "batch_kind": "${batch_kind}",
  "status": "skipped",
  "started_at": "${skipped_at}",
  "finished_at": "${skipped_at}",
  "failed_step": null,
  "reason": "lock_held",
  "lock_file": "${lock_file}"
}
EOF
  echo "skipped ${batch_kind}: lock is held (${lock_file})"
  exit 0
fi

if [[ -n "${python_bin}" ]]; then
  "${python_bin}" -m campus_ingestion_worker.deployment_preflight "${preflight_args[@]}"
else
  uv run --package campus-ingestion-worker campus-ingestion-preflight "${preflight_args[@]}"
fi

if [[ -n "${python_bin}" ]]; then
  batch_command=(
    "${python_bin}"
    -m
    campus_ingestion_worker.on_demand_batch_runner
    "${batch_kind}"
    --report-path
    "${report_path}"
    "$@"
  )
else
  batch_command=(
    uv
    run
    --all-packages
    python
    -m
    campus_ingestion_worker.on_demand_batch_runner
    "${batch_kind}"
    --report-path
    "${report_path}"
    "$@"
  )
fi

if "${batch_command[@]}"; then
  batch_exit_code=0
else
  batch_exit_code=$?
fi

retention_keep_failed_flag="--keep-failed"
case "$(printf '%s' "${retention_keep_failed}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    retention_keep_failed_flag="--keep-failed"
    ;;
  0|false|no|off)
    retention_keep_failed_flag="--no-keep-failed"
    ;;
  *)
    echo "invalid INGESTION_REPORT_RETENTION_KEEP_FAILED: ${retention_keep_failed}" >&2
    exit 2
    ;;
esac

if [[ -n "${python_bin}" ]]; then
  "${python_bin}" -m campus_ingestion_worker.report_retention \
    --report-dir "${report_dir}" \
    --max-age-days "${retention_max_age_days}" \
    --max-count "${retention_max_count}" \
    "${retention_keep_failed_flag}" >/dev/null || true
else
  uv run --package campus-ingestion-worker campus-ingestion-prune-reports \
    --report-dir "${report_dir}" \
    --max-age-days "${retention_max_age_days}" \
    --max-count "${retention_max_count}" \
    "${retention_keep_failed_flag}" >/dev/null || true
fi

exit "${batch_exit_code}"
