#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
limit="${INGESTION_ON_DEMAND_DRAIN_LIMIT:-100}"
batch_size="${INGESTION_ON_DEMAND_DRAIN_BATCH_SIZE:-20}"
max_attempts="${INGESTION_ON_DEMAND_DRAIN_MAX_ATTEMPTS:-3}"
consumer_admission_manifest_path="${INGESTION_ON_DEMAND_DRAIN_CONSUMER_ADMISSION_MANIFEST_PATH:-}"

if [[ -z "${consumer_admission_manifest_path}" ]]; then
  echo "INGESTION_ON_DEMAND_DRAIN_CONSUMER_ADMISSION_MANIFEST_PATH is required." >&2
  exit 2
fi

exec "${script_dir}/run-ingestion-worker-batch.sh" \
  internal-notice-multimodal-drain \
  --limit "${limit}" \
  --batch-size "${batch_size}" \
  --max-attempts "${max_attempts}" \
  --consumer-admission-manifest-path "${consumer_admission_manifest_path}"
