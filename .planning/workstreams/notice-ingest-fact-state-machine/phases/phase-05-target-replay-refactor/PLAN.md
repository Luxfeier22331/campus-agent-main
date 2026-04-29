---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Target Replay Refactor

## Goal

Refactor downstream target replay to consume target admission state derived from fact readiness.

## Tasks

1. Refactor `transport_schedule` replay:
   - remove unit-level `multimodal_status` hard block.
   - consume fact readiness.
   - preserve baseline-aware policy.
   - stage text-primary rows when body facts complete.
2. Refactor `service_status` replay:
   - consume fact readiness.
   - keep missing required facts blocked/deferred.
   - do not raw-scan source bundles.
3. Refactor `regulation` admission:
   - consume owner-text readiness.
   - keep no-write/offline-preparation posture where applicable.
4. Update worker previews to include source -> media -> fact -> target trace.
5. Update tests and expected fixtures.

## Acceptance Criteria

- `355881` produces 7 text-primary transport rows and no longer returns `multimodal_not_ready`.
- `355867` remains required-media blocked or OCR-primary according to supplied OCR evidence.
- Existing baseline coverage behavior remains intact.
- Service-status and regulation tests pass with fact readiness input.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_collected_notice_downstream_pilot \
  tests.ingestion.test_collected_notice_service_status_downstream_replay \
  tests.ingestion.test_preview_collected_notice_regulation_admission_worker -q
uv run --all-packages ruff check packages/ingestion-core apps/ingestion-worker tests/ingestion
uv run --all-packages ruff format packages/ingestion-core apps/ingestion-worker tests/ingestion --check
git diff --check
```
