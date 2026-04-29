---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
phase: 6R.1
plan: regulation-candidate-audit-and-admission
type: implementation
wave: 1
depends_on:
  - Phase 4.8
  - Phase 5
autonomous: true
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.1 Plan: Regulation Candidate Audit And Admission

## Objective

Build a no-write regulation candidate audit and consumer admission manifest from
the queue-backed searchable notice layer.

This phase decides which collected notices can proceed toward regulation target
materialization and which must remain searchable-only, multimodal-pending,
duplicate-held, or manual-review.

## Canonical References

- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/reference/internal-notice-manual-review-collection-strategy.md`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/phases/phase-02-chain-contract-and-admission-design/DOWNSTREAM-BATCHING-POLICY.md`
- Phase 4.8 queue-backed searchable evidence

## Inputs

- Searchable notice layer produced from queue consume
- Phase 5 multimodal readiness inventory
- Existing notice family / routing hints
- Existing regulation promotion manifest helpers

## Non-Goals

- No materialization into `regulations/*`.
- No canonical markdown generation.
- No document-units generation.
- No release, alias publish, or query-serving opening.
- No direct promotion of wrapper notices.

## Admission Classes

- `institutional_rules_candidate`
- `scoped_rules_candidate`
- `needs_multimodal`
- `wrapper_only_searchable`
- `duplicate_hold`
- `manual_review`
- `invalid_capture`

## Tasks

1. Select regulation candidates from searchable units.
   - Use explicit target hints and notice family signals.
   - Include attachment-backed candidates when source object refs exist.
   - Preserve source notice identity and searchable unit id.
2. Run regulation promotion audit without target writes.
   - Reuse existing promotion manifest logic where possible.
   - Do not create target documents in this phase.
3. Classify each candidate.
   - Institution-wide stable rules -> `institutional_rules_candidate`.
   - Annual/time-bound/school-specific implementation rules -> `scoped_rules_candidate`.
   - Wrapper-only publish/revision notice -> `wrapper_only_searchable`.
   - Missing owner body or unresolved OCR -> `needs_multimodal` or `manual_review`.
   - Duplicates -> `duplicate_hold`.
4. Emit evidence.
   - `regulation-consumer-admission-manifest.json`
   - `regulation-candidate-audit.json`
   - `regulation-rejected-deferred-source-report.json`
   - `regulation-source-to-searchable-trace.json`
5. Add tests.
   - Wrapper notice is not admitted as formal regulation.
   - `notice_id` is not used as target identity.
   - Institution-wide vs scoped rules split is stable.
   - Duplicate holds preserve provenance.
   - Multimodal-pending candidates do not proceed.

## Expected File Scope

- `packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_admission.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_admission.py`
- `tests/ingestion/test_collected_notice_regulation_admission.py`
- `tests/ingestion/test_preview_collected_notice_regulation_admission_worker.py`
- `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission/`

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_admission tests.ingestion.test_preview_collected_notice_regulation_admission_worker
uv run --all-packages python -m unittest tests.ingestion.internal_notice_regulation_promotion_manifest_followup_suite tests.ingestion.internal_notice_regulation_materialization_gate_suite
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_admission.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_admission.py tests/ingestion/test_collected_notice_regulation_admission.py tests/ingestion/test_preview_collected_notice_regulation_admission_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_regulation_admission.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_regulation_admission.py tests/ingestion/test_collected_notice_regulation_admission.py tests/ingestion/test_preview_collected_notice_regulation_admission_worker.py
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```

## Success Criteria

- Every regulation-like source receives one explicit admission class.
- Wrapper notices stay in searchable layer and do not enter `regulations/*`.
- Candidate rows preserve searchable unit id and source object refs.
- No target materialization or query-serving opening occurs.

## Completion Summary

Completed on 2026-04-29.

Implemented a queue-backed, no-write regulation candidate admission preview:

- regenerated Phase 4.8 queue consume evidence for all `338` historical jobs;
- selected `106` regulation-like searchable units from the queue-backed trace;
- classified `92` as `needs_multimodal` and `14` as `manual_review`;
- admitted `0` sources to downstream regulation materialization because current collected data lacks OCR/materialized owner text for file-release regulations and no parent notice qualifies as canonical regulation text;
- emitted all four required evidence artifacts under `evidence/phase-06-r1-regulation-candidate-audit-and-admission/`.

The result intentionally keeps `regulations/*` untouched. Phase 6R.2 should not materialize regulation targets until multimodal/OCR output promotes at least one owner text from `needs_multimodal` into a ready candidate.
