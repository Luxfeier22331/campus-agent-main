---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary

Implemented operator-side collector attachment fetch admission wiring.

Committed result:

- `d486aa1a feat: 添加通知附件 fetch admission operator wiring`

Delivered:

- Added `campus_ingestion_worker.build_authenticated_notice_attachment_fetch_request_manifest`.
- Added console script `campus-ingestion-build-authenticated-notice-attachment-fetch-request-manifest`.
- Added package lazy export `build_authenticated_notice_attachment_fetch_request_manifest_main`.
- Added worker tests for selected source-truth manifest generation, metadata-only omission, required/admitted owner admission rows, and missing selected notice fail-closed behavior.
- Updated collector README and bootstrap smoke runbook to clarify that notice attachments stay reference-only unless admitted by manifest.
- Registered `authenticated-notice-fetch-admission-operator-wiring` as an active workstream.

Verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest \
  tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest_worker -q
pnpm --dir apps/authenticated-notice-collector test -- bootstrap-export.test.ts config.test.ts
pnpm --dir apps/authenticated-notice-collector typecheck
uv run --all-packages ruff check \
  apps/ingestion-worker/src/campus_ingestion_worker/build_authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest_worker.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py
uv run --all-packages ruff format \
  apps/ingestion-worker/src/campus_ingestion_worker/build_authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest_worker.py \
  packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py \
  tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py --check
pnpm docs:lint
git diff --check
```
