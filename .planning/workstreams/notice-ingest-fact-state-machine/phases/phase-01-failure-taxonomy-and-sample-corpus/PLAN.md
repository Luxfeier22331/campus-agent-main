---
doc_type: plan
status: planned
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Failure Taxonomy And Sample Corpus

## Goal

Create a deterministic sample corpus that captures current failures and desired behavior across schedule, service-status, regulation, WeChat and search-only notices.

## Context

Primary regression:

- `355881` should be `transport_schedule.stage_ready` from body text.
- Its inline image should be `supplemental_location_visual`, not `schedule_table_carrier`.
- Current target replay blocks it with `multimodal_not_ready`.

Counterexample:

- `355867` should remain OCR-primary because schedule facts live in table images.

## Tasks

1. Create `FAILURE-TAXONOMY.md`.
2. Create `SAMPLE-CORPUS.md`.
3. Generate `sample-corpus.json` with source ids, titles, expected target state, expected media role and expected fact readiness.
4. Add a current-behavior audit script or test helper that runs existing functions without writes.
5. Capture current behavior for:
   - `355881`
   - `355867`
   - `355122`
   - `355512`
   - one service-status text-complete notice
   - one service-status media-dependent notice
   - one file-release regulation owner document
   - one ordinary notice with image that must stay search-only
   - one WeChat public notice with image refs
6. Write `phase-01-summary.md` with observed drift and expected target behavior.

## Implementation Notes

- Prefer using existing closeout evidence under
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/`.
- Do not write PG, object store, release or current truth.
- Do not infer regulation from weak notice keywords; use existing target hardening assumptions from the completed closeout.

## Acceptance Criteria

- Corpus includes both positive and negative samples for required media.
- `355881` expected output explicitly says `ready_from_text` and `supplemental_media_pending`.
- `355867` expected output explicitly says `blocked_by_required_media` until OCR rows are ready.
- Current behavior audit records that the existing path blocks `355881` incorrectly.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_downstream_pilot -q
pnpm docs:lint
git diff --check
```
