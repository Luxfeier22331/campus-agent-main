# Quick Task 260411-r4m Verification

## Read-Only Checks

### 1. Object Storage Manifest Re-read

Command family:

- `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python - <<'PY' ...`

Observed facts:

- `campus_notices/releases/internal_notice/r20260411_090101/index-release.json` exists
- `campus_notices/releases/internal_notice/r20260411_090101/validation-summary.json` exists
- manifest fields:
  - `release_id = r20260411_090101`
  - `collection = internal_notice`
  - `physical_collection_name = internal_notice__r20260411_090101`
  - `published_at = null`
  - `document_count = 21`
  - `point_count = 213`
  - `validation_status = passed`
- validation summary fields:
  - `chunk_count = 213`
  - `unit_type_counts.policy_page = 20`
  - `unit_type_counts.article_body = 190`
  - `unit_type_counts.attachment_title = 1`
  - `unit_type_counts.attachment_body = 2`

### 2. Qdrant Collection / Alias Verification

Command family:

- `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-ingestion-worker python - <<'PY' ...`

Observed facts:

- `internal_notice__r20260411_090101` exists
- `status = green`
- `points_count = 213`
- `indexed_vectors_count = 213`
- `alias_targets for internal_notice = []`

Conclusion:

- The guarded release is real and healthy
- The serving alias is still intentionally unpublished

### 3. Proxy-Sensitive Qdrant Access

Inherited-proxy probe:

- command:
  - `curl --max-time 10 -sS -o /tmp/qdrant-proxy-check.json -w '%{http_code}\n' -H "api-key: $QDRANT_API_KEY" "$QDRANT_URL/collections"`
- observed:
  - `curl: (28) Connection timed out after 10001 milliseconds`
  - HTTP code `000`

Direct no-proxy probe:

- command:
  - `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy curl --max-time 10 -sS -o /tmp/qdrant-direct-check.json -w '%{http_code}\n' -H "api-key: $QDRANT_API_KEY" "$QDRANT_URL/collections"`
- observed:
  - HTTP code `200`

Operator conclusion:

- Current WSL shell must bypass inherited host proxy for Qdrant Cloud inspection/release work
- In repo-owned release commands, the durable fix is to blank uppercase/lowercase proxy vars, not merely unset them

## Final Verdict

- Wave D guarded release closeout is documented and verified
- No rerun of `release_registry_scope` is needed
- Next repo-local authenticated-notice work moves to post-release consumption and regulation-promotion follow-up
