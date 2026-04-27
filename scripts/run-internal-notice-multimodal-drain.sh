#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
limit="${INGESTION_ON_DEMAND_DRAIN_LIMIT:-100}"
batch_size="${INGESTION_ON_DEMAND_DRAIN_BATCH_SIZE:-20}"
max_attempts="${INGESTION_ON_DEMAND_DRAIN_MAX_ATTEMPTS:-3}"

exec "${script_dir}/run-ingestion-worker-batch.sh" \
  internal-notice-multimodal-drain \
  --limit "${limit}" \
  --batch-size "${batch_size}" \
  --max-attempts "${max_attempts}"
