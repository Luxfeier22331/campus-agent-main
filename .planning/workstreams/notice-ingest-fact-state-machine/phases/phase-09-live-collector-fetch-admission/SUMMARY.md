---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 9 Summary

Implemented live collector fetch admission for authenticated notice attachment bytes.

## Completed

- Collector default is now metadata/reference-only for notice attachments, even with an artifact store configured.
- Attachment bytes are downloaded only when an explicit fetch admission is provided.
- Added parser support for ingestion-core fetch request manifests and the env entrypoint `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH`.
- Added ingestion-core `authenticated_notice_attachment_fetch_request_manifest_v1` builder.
- Run ledger verification now treats only `fetch_required_for_source_truth` and `fetch_required_for_admitted_owner` as required source byte objects; quarantine fetches are not required source objects.

## Verification

- `pnpm --dir apps/authenticated-notice-collector test -- bootstrap-export.test.ts`
- `pnpm --dir apps/authenticated-notice-collector test -- bootstrap-export.test.ts config.test.ts portal.test.ts`
- `pnpm --dir apps/authenticated-notice-collector typecheck`
- `uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest -q`
- `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py`
