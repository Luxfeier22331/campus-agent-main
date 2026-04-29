---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 6R.1a
plan: regulation-owner-text-recovery-mini-batch
type: implementation
wave: 1
depends_on:
  - Phase 5
  - Phase 6R.1
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.1a Plan: Regulation Owner Text Recovery Mini-Batch

## Objective

Create a no-write owner-text recovery mini-batch for regulation candidates that
Phase 6R.1 classified as `needs_multimodal`.

This phase does not run OCR or provider calls. It prepares the exact batch,
source object refs, normalized output refs, rerun contract, and gap report
needed before a later execution step can recover canonical owner text.

## Inputs

- Phase 6R.1 `regulation-consumer-admission-manifest.json`
- Phase 5 `multimodal-candidate-inventory.json`

## Non-Goals

- No provider calls.
- No object-store writes.
- No database writes.
- No `regulations/*` materialization.
- No Phase 6R.2 promotion.
- No fabricated OCR / owner-text output.

## Selection Policy

- Input admission class must be `needs_multimodal`.
- Default source surface is `file_release`.
- Default media kinds are `pdf` and `office`.
- Candidate must be Phase 5 `pending`.
- Candidate must preserve source object ref and normalized output refs.
- Default mini-batch limit is `10`.
- Remaining eligible candidates are deferred with `batch_limit_deferred`.
- Notice-surface candidates remain deferred until a separate owner-text policy
  explicitly admits them.

## Deliverables

- `regulation-owner-text-recovery-batch-manifest.json`
- `regulation-owner-text-attempt-plan.json`
- `regulation-owner-text-searchable-merge-contract.json`
- `regulation-owner-text-readiness-gap-report.json`

## Code Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_models.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_owner_text_recovery.py`
- `tests/ingestion/test_collected_notice_regulation_owner_text_recovery.py`
- `tests/ingestion/test_preview_collected_notice_regulation_owner_text_recovery_worker.py`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_owner_text_recovery tests.ingestion.test_preview_collected_notice_regulation_owner_text_recovery_worker
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_admission tests.ingestion.test_collected_notice_multimodal_readiness
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_models.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_owner_text_recovery.py tests/ingestion/test_collected_notice_regulation_owner_text_recovery.py tests/ingestion/test_preview_collected_notice_regulation_owner_text_recovery_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_constants.py packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_owner_text_recovery_models.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_owner_text_recovery.py tests/ingestion/test_collected_notice_regulation_owner_text_recovery.py tests/ingestion/test_preview_collected_notice_regulation_owner_text_recovery_worker.py
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```

## Success Criteria

- Phase 6R.1 `needs_multimodal` regulation candidates are not promoted.
- File-release owner-text recovery attempts have source object refs and planned
  normalized output refs.
- Attempt plan explicitly requires Phase 5, Phase 6R.1, and Phase 6R.2 reruns
  after owner text is ready.
- Gap report explains missing candidate or deferred rows.
- All outputs are no-write dry-run evidence.
