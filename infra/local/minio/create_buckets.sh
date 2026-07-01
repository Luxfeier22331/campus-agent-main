#!/usr/bin/env bash
set -euo pipefail

MC_BIN="${MC_BIN:-mc}"
MINIO_ALIAS="${MINIO_ALIAS:-local}"
MINIO_ENDPOINT="${OBJECT_STORE_ENDPOINT:-http://127.0.0.1:9000}"
MINIO_ACCESS_KEY="${OBJECT_STORE_ACCESS_KEY:-minioadmin}"
MINIO_SECRET_KEY="${OBJECT_STORE_SECRET_KEY:-minioadmin}"
SOURCE_BUCKET="${OBJECT_STORE_BUCKET_SOURCE:-campus-agent-source}"
DERIVED_BUCKET="${OBJECT_STORE_BUCKET_DERIVED:-campus-agent-derived}"

"${MC_BIN}" alias set "${MINIO_ALIAS}" "${MINIO_ENDPOINT}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}"
"${MC_BIN}" mb --ignore-existing "${MINIO_ALIAS}/${SOURCE_BUCKET}"
"${MC_BIN}" mb --ignore-existing "${MINIO_ALIAS}/${DERIVED_BUCKET}"
