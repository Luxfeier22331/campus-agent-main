#!/usr/bin/env bash
set -euo pipefail

batch_kind="${INGESTION_ON_DEMAND_BATCH_KIND:-internal-notice-multimodal-drain}"

exec /app/scripts/run-ingestion-worker-batch.sh "${batch_kind}" "$@"
