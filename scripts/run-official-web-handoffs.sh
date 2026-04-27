#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
limit="${INGESTION_ON_DEMAND_OFFICIAL_WEB_LIMIT:-20}"
promote="${INGESTION_ON_DEMAND_OFFICIAL_WEB_PROMOTE:-0}"
force="${INGESTION_ON_DEMAND_OFFICIAL_WEB_FORCE:-0}"
event_id="${INGESTION_ON_DEMAND_OFFICIAL_WEB_EVENT_ID:-}"

args=(--limit "${limit}")
if [[ "${promote}" == "1" || "${promote}" == "true" ]]; then
  args+=(--promote)
fi
if [[ "${force}" == "1" || "${force}" == "true" ]]; then
  args+=(--force)
fi
if [[ -n "${event_id}" ]]; then
  args+=(--event-id "${event_id}")
fi

exec "${script_dir}/run-ingestion-worker-batch.sh" official-web-handoffs "${args[@]}"
