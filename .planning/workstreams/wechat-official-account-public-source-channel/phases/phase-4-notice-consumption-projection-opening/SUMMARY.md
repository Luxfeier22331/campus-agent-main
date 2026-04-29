---
doc_type: summary
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 4 Summary

Phase 4 completed the offline `wechat_public_notice` projection opening while
keeping query-serving closed.

## Delivered

- Added `wechat_public_notice` to shared notice-family contracts.
- Added WeChat source-truth projection module in `packages/ingestion-core`:
  - reads only `article-manifest.json` / `content-blocks.jsonl` /
    `media-refs.jsonl`
  - validates `sourceChannel=wechat_official_account` and
    `bodyState=not_captured`
  - enforces forbidden-field checks for source-truth payloads
  - materializes deterministic notice-consumption projection rows
  - applies cross-source dedupe precedence:
    `internal_notice_restricted > official_web_public_notice > wechat_public_notice`
  - records duplicate suppression metadata as `unsupported/no_adoption`
  - preserves idempotent same-article rerun behavior for existing WeChat rows
- Added ingestion-worker CLI
  `campus-ingestion-project-wechat-public-notices` with:
  - selected manifest refs / selection file input
  - optional read-model evidence emission
  - dry-run support
  - internal notice consumption admission recording
  - deterministic JSON report (retained/duplicate/evidence counts,
    `query_serving_opened=false`)
- Added Go runtime regression guard proving `wechat_public_notice` stays
  fail-closed in `campus_notice_discover`.

## Verification

- `uv run --all-packages python -m unittest tests.contracts.contract_models_services_and_notice_suite tests.ingestion.test_wechat_public_notice_projection tests.ingestion.test_project_wechat_public_notices_worker`
- `go test ./internal/structuredquery -run Notice` (in `apps/supervisor-api`)
- `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/wechat_public_notice_projection.py apps/ingestion-worker/src/campus_ingestion_worker/project_wechat_public_notices.py tests/ingestion/test_wechat_public_notice_projection.py tests/ingestion/test_project_wechat_public_notices_worker.py`

## Boundary Status

- `wechat_public_notice` is now admitted in contracts and ingestion projection
  lane.
- Go query runtime remains closed for this source family by design.
- No document registry/chunk/index/release alias/query-serving opening was added
  in this phase.
