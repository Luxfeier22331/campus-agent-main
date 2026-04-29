#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
run_id="${INGESTION_ON_DEMAND_CLOSEOUT_RUN_ID:-notice-$(date -u +%Y%m%d)}"
parallel_workers="${INGESTION_ON_DEMAND_CLOSEOUT_PARALLEL_WORKERS:-1}"
worker_id="${INGESTION_ON_DEMAND_CLOSEOUT_WORKER_ID:-ondemand}"
batch_size="${INGESTION_ON_DEMAND_CLOSEOUT_BATCH_SIZE:-16}"
max_concurrency="${INGESTION_ON_DEMAND_CLOSEOUT_MAX_CONCURRENCY:-1}"
notice_concurrency="${INGESTION_ON_DEMAND_CLOSEOUT_NOTICE_CONCURRENCY:-2}"
object_store_concurrency="${INGESTION_ON_DEMAND_CLOSEOUT_OBJECT_STORE_CONCURRENCY:-2}"
lease_seconds="${INGESTION_ON_DEMAND_CLOSEOUT_LEASE_SECONDS:-300}"
validate_chunking="${INGESTION_ON_DEMAND_CLOSEOUT_VALIDATE_CHUNKING:-1}"
promote="${INGESTION_ON_DEMAND_CLOSEOUT_PROMOTE:-0}"
bundle_path="${INGESTION_ON_DEMAND_CLOSEOUT_BUNDLE_PATH:-}"
manifest_path="${INGESTION_ON_DEMAND_CLOSEOUT_MANIFEST_PATH:-}"
site_id="${INGESTION_ON_DEMAND_CLOSEOUT_SITE_ID:-}"
source_home_url="${INGESTION_ON_DEMAND_CLOSEOUT_SOURCE_HOME_URL:-}"

args=(
  --run-id "${run_id}"
  --parallel-workers "${parallel_workers}"
  --worker-id "${worker_id}"
  --batch-size "${batch_size}"
  --max-concurrency "${max_concurrency}"
  --notice-concurrency "${notice_concurrency}"
  --object-store-concurrency "${object_store_concurrency}"
  --lease-seconds "${lease_seconds}"
)
if [[ "${validate_chunking}" == "1" || "${validate_chunking}" == "true" ]]; then
  args+=(--validate-chunking)
fi
if [[ "${promote}" == "1" || "${promote}" == "true" ]]; then
  args+=(--promote)
fi
if [[ -n "${bundle_path}" ]]; then
  args+=(--bundle-path "${bundle_path}")
  [[ -n "${site_id}" ]] && args+=(--site-id "${site_id}")
  [[ -n "${source_home_url}" ]] && args+=(--source-home-url "${source_home_url}")
fi
if [[ -n "${manifest_path}" ]]; then
  args+=(--manifest-path "${manifest_path}")
fi

exec "${script_dir}/run-ingestion-worker-batch.sh" authenticated-notice-closeout "${args[@]}"
