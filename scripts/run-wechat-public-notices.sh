#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
selection_path="${INGESTION_ON_DEMAND_WECHAT_SELECTION_PATH:-}"
article_manifest_key="${INGESTION_ON_DEMAND_WECHAT_ARTICLE_MANIFEST_KEY:-}"
source_bucket="${INGESTION_ON_DEMAND_WECHAT_SOURCE_BUCKET:-}"
capture_run_id="${INGESTION_ON_DEMAND_WECHAT_CAPTURE_RUN_ID:-}"
latest_capture_run="${INGESTION_ON_DEMAND_WECHAT_LATEST_COMPLETED_CAPTURE_RUN:-0}"
capture_account_slug="${INGESTION_ON_DEMAND_WECHAT_CAPTURE_ACCOUNT_SLUG:-}"
dry_run="${INGESTION_ON_DEMAND_WECHAT_DRY_RUN:-0}"
emit_read_model_evidence="${INGESTION_ON_DEMAND_WECHAT_EMIT_READ_MODEL_EVIDENCE:-0}"
multimodal_drain="${INGESTION_ON_DEMAND_WECHAT_MULTIMODAL_DRAIN:-1}"
multimodal_drain_limit="${INGESTION_ON_DEMAND_WECHAT_MULTIMODAL_DRAIN_LIMIT:-100}"
multimodal_drain_batch_size="${INGESTION_ON_DEMAND_WECHAT_MULTIMODAL_DRAIN_BATCH_SIZE:-20}"
multimodal_drain_max_attempts="${INGESTION_ON_DEMAND_WECHAT_MULTIMODAL_DRAIN_MAX_ATTEMPTS:-3}"
multimodal_drain_skip_read_model_rebuild="${INGESTION_ON_DEMAND_WECHAT_MULTIMODAL_DRAIN_SKIP_READ_MODEL_REBUILD:-0}"

args=()
if [[ -n "${selection_path}" ]]; then
  args+=(--selection-path "${selection_path}")
fi
if [[ -n "${article_manifest_key}" ]]; then
  args+=(--article-manifest-key "${article_manifest_key}")
fi
if [[ -n "${source_bucket}" ]]; then
  args+=(--source-bucket "${source_bucket}")
fi
if [[ -n "${capture_run_id}" ]]; then
  args+=(--capture-run-id "${capture_run_id}")
fi
if [[ "${latest_capture_run}" == "1" || "${latest_capture_run}" == "true" ]]; then
  args+=(--latest-completed-capture-run)
fi
if [[ -n "${capture_account_slug}" ]]; then
  args+=(--capture-account-slug "${capture_account_slug}")
fi
if [[ "${dry_run}" == "1" || "${dry_run}" == "true" ]]; then
  args+=(--dry-run)
fi
if [[ "${emit_read_model_evidence}" == "1" || "${emit_read_model_evidence}" == "true" ]]; then
  args+=(--emit-read-model-evidence)
fi

if [[ ${#args[@]} -eq 0 ]]; then
  echo "wechat batch requires explicit selection args via env (selection path, manifest key, or capture run)." >&2
  exit 2
fi

"${script_dir}/run-ingestion-worker-batch.sh" wechat-public-notices "${args[@]}"

if [[ "${dry_run}" == "1" || "${dry_run}" == "true" ]]; then
  exit 0
fi

if [[ "${multimodal_drain}" != "1" && "${multimodal_drain}" != "true" ]]; then
  exit 0
fi

multimodal_args=(
  --limit "${multimodal_drain_limit}"
  --batch-size "${multimodal_drain_batch_size}"
  --max-attempts "${multimodal_drain_max_attempts}"
)
if [[ "${multimodal_drain_skip_read_model_rebuild}" == "1" || "${multimodal_drain_skip_read_model_rebuild}" == "true" ]]; then
  multimodal_args+=(--skip-read-model-rebuild)
fi

exec "${script_dir}/run-ingestion-worker-batch.sh" \
  wechat-public-notice-multimodal-drain \
  "${multimodal_args[@]}"
