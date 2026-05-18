---
doc_type: summary
phase: phase-08-captured-content-smoke
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Summary: Captured Content Smoke

## Completed

- Replayed already collected authenticated notice artifacts through current
  code: 58 captured runs, 338 source-truth candidates, and 338 searchable units.
- Recomputed fetch requests from current notice attachment refs and produced 0
  fetch requests / 0 required source-object fetches for the captured cohort.
- Rebuilt media extraction readiness: 60 target media candidates, split into 56
  released-file text extraction PDFs and 4 schedule-image OCR candidates.
- Verified all 60 target media source objects against live object storage.
- Replayed downstream admission by title:
  - transport schedule: 4 entries, 2 admitted, 2 `needs_multimodal`.
  - service status: 3 entries, 1 admitted, 2 deferred.
  - regulation: 42 entries, all `needs_multimodal` pending owner-document text.
- Applied available closeout evidence:
  - OCR closeout completed 2 `355867` schedule images and mapped 1
    low-confidence result to `manual_review`.
  - manual terminal closeout mapped that low-confidence image to
    `failed_terminal`.
  - `355122` remains blocked by 1 pending schedule image after available
    closeout evidence.
- Ran cleanup dry-runs against pending, OCR-closeout, and manual-terminal
  inventories. Cleanup blocks target-blocking non-terminal media and releases
  only terminalized quarantine refs.
- Generated operator-facing summary evidence at
  `evidence/phase-08-captured-content-smoke/captured-content-smoke-summary.json`.

## Acceptance

- No whole-unit pending media status alone produces downstream
  `needs_multimodal`; downstream blocking is tied to explicit
  `target_blocking=true` candidates.
- `manual_review` remains non-terminal and cleanup-blocking.
- `failed_terminal` is terminal for cleanup release.
- Permanent source-truth PDF bytes are not forced through quarantine cleanup
  protection.
- Search-only/discover-only content does not create target-admission manifest
  obligations.
- Downstream admission manifests expose top-level `required_fact_groups`,
  `ready_fact_groups`, and `missing_fact_groups` for operator review.

## Evidence

- `evidence/phase-08-captured-content-smoke/captured-content-smoke-summary.json`
- `evidence/phase-08-captured-content-smoke/reimport-preview-current/reimport-plan.dry-run.json`
- `evidence/phase-08-captured-content-smoke/fetch-request-manifest-current.json`
- `evidence/phase-08-captured-content-smoke/media-readiness-current/media-extraction-candidate-inventory.json`
- `evidence/phase-08-captured-content-smoke/downstream-transport-schedule/consumer-admission-manifest.json`
- `evidence/phase-08-captured-content-smoke/downstream-service-status/consumer-admission-manifest.json`
- `evidence/phase-08-captured-content-smoke/downstream-regulation/regulation-consumer-admission-manifest.json`
- `evidence/phase-08-captured-content-smoke/source-object-verification/media-source-object-verification-report.json`
- `evidence/phase-08-captured-content-smoke/media-closeout-state-machine-audit-current.stdout.json`

## Verification

Required verification command:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_authenticated_notice_state_machine_audit \
  tests.ingestion.test_collected_notice_multimodal_readiness \
  tests.ingestion.test_collected_notice_fact_readiness \
  tests.ingestion.test_collected_notice_media_extraction_closeout \
  tests.ingestion.test_collected_notice_regulation_admission \
  tests.ingestion.test_collected_notice_service_status_downstream_replay \
  tests.ingestion.test_official_transport_baseline_preview \
  tests.ingestion.test_collected_notice_media_closeout_state_machine_audit \
  tests.ingestion.test_collected_notice_media_closeout_state_machine_worker \
  tests.ingestion.test_authenticated_notice_attachment_key_cleanup \
  tests.ingestion.test_collected_notice_schedule_image_ocr_mini_batch \
  tests.ingestion.test_collected_notice_regulation_owner_text_execution -q
```

Additional checks:

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_fact_readiness.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_downstream_pilot.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_service_status_downstream_replay.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_admission.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_media_extraction_closeout.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_media_closeout_state_machine_audit.py \
  packages/ingestion-core/src/campus_ingestion_core/collected_notice_media_closeout_state_machine_audit_support.py \
  tests/ingestion/test_collected_notice_media_closeout_state_machine_audit.py \
  tests/ingestion/test_collected_notice_service_status_downstream_replay.py \
  tests/ingestion/test_collected_notice_schedule_image_ocr_mini_batch.py \
  tests/ingestion/test_collected_notice_regulation_owner_text_execution.py
pnpm docs:lint
```

## Remaining

Fresh selected collector smoke remains useful only as an auth-dependent
manifest-consumption proof. It should not reopen Phase 8 state-machine
acceptance unless refreshed live collector output contradicts the captured
content evidence.
