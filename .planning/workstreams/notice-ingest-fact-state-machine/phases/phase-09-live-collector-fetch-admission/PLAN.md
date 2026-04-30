---
doc_type: plan
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 9: Live Collector Fetch Admission

## Objective

Move authenticated notice attachment byte retention from preview/source-truth metadata into live collector behavior.

## Tasks

- Add collector tests proving internal attachments and allowlisted external inline images remain reference-only by default even when an artifact store is configured.
- Add explicit collector admission tests proving only admitted attachment refs are downloaded/uploaded.
- Add ingestion-core fetch request manifest builder for `fetch_to_quarantine`, `fetch_required_for_source_truth`, and `fetch_required_for_admitted_owner`.
- Add collector config and parser support for `AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_REQUEST_MANIFEST_PATH`.
- Align run ledger required source object verification with explicit required/admitted owner bytes; quarantine fetches do not count as required source objects.

## Verification

```bash
pnpm --dir apps/authenticated-notice-collector test -- bootstrap-export.test.ts config.test.ts portal.test.ts
pnpm --dir apps/authenticated-notice-collector typecheck
uv run --all-packages python -m unittest tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest -q
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py
uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_attachment_fetch_request_manifest.py tests/ingestion/test_authenticated_notice_attachment_fetch_request_manifest.py --check
```
