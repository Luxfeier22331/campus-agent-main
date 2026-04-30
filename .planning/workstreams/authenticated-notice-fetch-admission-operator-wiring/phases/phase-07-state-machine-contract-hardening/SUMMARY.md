---
doc_type: summary
phase: phase-07-state-machine-contract-hardening
status: completed
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Summary: State Machine Contract Hardening

## Completed

- Replaced contract-facing OCR lifecycle vocabulary with canonical media states:
  `pending`, `completed`, `skipped`, `manual_review`, `failed_retryable`, and
  `failed_terminal`.
- Removed whole-unit `media_text_status=pending` / `multimodal_status=pending`
  fallback from target admission when there is no explicit
  `target_blocking=true` media extraction candidate.
- Mapped low-confidence schedule OCR closeout to `manual_review` instead of a
  generic failed state.
- Mapped owner-text execution failures to `failed_retryable`.
- Preserved closeout result manifest provenance on updated candidates.
- Added fail-fast candidate inventory validation for `candidate_id`, `status`,
  `target_blocking`, and source object refs required by blocking candidates.
- Unified attachment bytes availability across source retention and fetch
  request admission. Stale `object_key` + hash without non-reference storage
  provider and uploaded/downloaded ingest state no longer suppresses fetch.
- Updated source-truth schema documentation with canonical lifecycle and bytes
  availability rules.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_source_retention_decision \
  tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest \
  tests.ingestion.test_authenticated_notice_attachment_fetch_request_manifest_worker \
  tests.ingestion.test_collected_notice_multimodal_readiness \
  tests.ingestion.test_preview_collected_notice_multimodal_readiness_worker \
  tests.ingestion.test_collected_notice_fact_readiness \
  tests.ingestion.test_collected_notice_media_role_classifier \
  tests.ingestion.test_collected_notice_ingest_fact_state_contract \
  tests.ingestion.test_collected_notice_media_extraction_closeout \
  tests.ingestion.test_official_transport_baseline_preview \
  tests.ingestion.test_preview_official_transport_baseline_worker \
  tests.ingestion.test_collected_notice_regulation_admission \
  tests.ingestion.test_preview_collected_notice_regulation_admission_worker \
  tests.ingestion.test_authenticated_notice_state_machine_audit -q
```

Result: 53 tests passed.

Additional checks:

- `uv run --all-packages ruff check ...`
- `uv run --all-packages ruff format ... --check`
- `pnpm docs:lint`
- `git diff --check`

## Remaining

- Phase 8 should validate already captured content through the hardened state
  machine before returning to live selected collector smoke. Fresh collector
  proof remains auth-dependent and is no longer the immediate acceptance gate.
