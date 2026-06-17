#!/usr/bin/env bash
set -euo pipefail

exec uv run --project /app --package campus-ingestion-worker python -m \
  campus_ingestion_worker.normalize_authenticated_notice_legacy_office_attachment "$@"
