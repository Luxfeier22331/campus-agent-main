---
doc_type: state
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Project State

## Current Position

**Status:** Active
**Current Phase:** Phase 1 planned
**Last Activity:** 2026-04-30
**Last Activity Description:** Workstream created and complete GSD planning documents added.

## Progress

**Phases Complete:** 0
**Current Plan:** `phases/phase-01-failure-taxonomy-and-sample-corpus/PLAN.md`

## Current Slice

Failure taxonomy and sample corpus.

## Why This Workstream Exists

The collected notice replay closeout exposed a structural ingest flaw:

- `355881` has complete transport schedule facts in body text.
- Direct text extraction can produce 7 transport rows.
- The current replay path blocks the whole target because the notice has a pending inline image.
- That image is supplemental location evidence, not the schedule table carrier.

This is not a single-notice bug. It means the current chain is mixing source/media readiness with target fact readiness.

## Completed Tasks

- [x] Created native workstream directory with `gsd-sdk query workstream.create`.
- [x] Defined workstream scope, target shape, owned scope and non-owned scope.
- [x] Planned seven phases from taxonomy to closeout guardrails.
- [x] Added Phase 1-7 executable `PLAN.md` files.
- [x] Registered the new active workstream in `.planning/WORKSTREAMS.md`.

## Current Phase Tasks

- [ ] Build `FAILURE-TAXONOMY.md`.
- [ ] Build `SAMPLE-CORPUS.md`.
- [ ] Generate `sample-corpus.json` from existing closeout evidence and focused fixtures.
- [ ] Audit current behavior for `355881`, `355867`, service-status, regulation and search-only image samples.
- [ ] Produce Phase 1 summary and verification output.

## Known Non-Overlap

- Does not reopen `collected-notice-consumption-replay-closeout`; that workstream remains completed.
- Does not change collector provider selection or authentication.
- Does not introduce scheduler, Kafka, Temporal, Step Functions or new public serving surface.
- Does not implement OCR provider logic; it consumes existing OCR/multimodal attempt outputs.

## Blockers

- No planning blocker.
- Implementation should start with Phase 1 corpus before touching target replay code.

## Verification Plan

Planning-only verification:

```bash
pnpm docs:lint
git diff --check
```

Implementation verification is phase-specific and recorded in `ROADMAP.md` and each phase `PLAN.md`.

## Resume Notes

Start with:

- `README.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `phases/phase-01-failure-taxonomy-and-sample-corpus/PLAN.md`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_downstream_pilot.py`
- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_transport_baseline_policy.py`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-04-dry-run-reimport-and-universal-search-preview/searchable-notice-preview.json`
