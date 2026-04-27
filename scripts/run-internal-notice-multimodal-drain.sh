#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${CAMPUS_AGENT_REPO_ROOT:-$(cd -- "${script_dir}/.." && pwd)}"
report_dir="${INGESTION_ON_DEMAND_REPORT_DIR:-.tmp/ingestion-reports}"
limit="${INGESTION_ON_DEMAND_DRAIN_LIMIT:-100}"
batch_size="${INGESTION_ON_DEMAND_DRAIN_BATCH_SIZE:-20}"
max_attempts="${INGESTION_ON_DEMAND_DRAIN_MAX_ATTEMPTS:-3}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

cd "${repo_root}"
mkdir -p "${report_dir}"

uv run --all-packages python -m campus_ingestion_worker.on_demand_batch_runner \
  internal-notice-multimodal-drain \
  --limit "${limit}" \
  --batch-size "${batch_size}" \
  --max-attempts "${max_attempts}" \
  --report-path "${report_dir}/internal-notice-multimodal-${timestamp}.json"
