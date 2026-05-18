---
doc_type: phase_plan
status: completed
workstream: historical-regulation-canonical-chunk-backfill
phase: phase-00-chunk-only-boundary-and-inventory
created: 2026-05-02
updated: 2026-05-02
---
# Phase 0: Chunk-Only Boundary And Inventory

## Goal

Freeze the execution contract for historical stock regulation processing and
produce an inventory of targets that can be safely taken only as far as chunk
preparation.

## Required Outputs

- `target-inventory.json` with every selected historical regulation target.
- `classification-report.json` with `admit_to_chunk`, `reject` and
  `needs_recovery` buckets.
- `canonical-provenance-preflight.json` showing current cleaning/document-units
  readiness for each `admit_to_chunk` target.
- `chunk-only-execution-plan.md` listing commands for the next phases.
- `serving-closed-assertion.json` proving no candidate enqueue, embedding, index
  release or alias publish is part of this phase.
- `candidate-store-noop-assertion.json` proving this phase did not repair,
  requeue or advance existing `rag_release_candidate` state.

## Runtime Evidence

Produced under:

`.planning/workstreams/historical-regulation-canonical-chunk-backfill/evidence/phase-00-chunk-only-boundary-and-inventory/`

Observed result:

- `target-inventory.json`: 10 selected historical regulation targets.
- `classification-report.json`: all 10 targets classified as `admit_to_chunk`.
- `canonical-provenance-preflight.json`: `overall_verdict=passed`, 10 passed, 0
  failed.
- `chunk-only-execution-plan.md`: points to the historical target-limited worker,
  not collection-wide registry scope preparation.
- `serving-closed-assertion.json`: all serving/release/embedding/index/alias
  flags false.
- `candidate-store-noop-assertion.json`: no candidate-store mutation.

The generated execution plan intentionally uses:

```bash
uv run --all-packages campus-ingestion-prepare-historical-regulation-chunk-backfill
```

It must not be replaced by `campus-ingestion-prepare-registry-scope-chunks`,
because the generic command selects the current collection scope rather than the
Phase 0 historical cohort.

## Input Evidence

- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-13-historical-regulation-canonical-backfill/canonical-backfill-report.json`
- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-13-historical-regulation-canonical-backfill/first-batch/materialization.execute.json`
- `.planning/workstreams/authenticated-notice-regulation-consumption/evidence/phase-13-historical-regulation-canonical-backfill/manual-review/materialization.execute.json`
- `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/evidence/`

Release-lane evidence may be read only as a negative guard, not as an inventory
source:

- `.planning/workstreams/regulation-rag-release-lane/evidence/phase-08-release-admission-hardening/institutional-final-candidate-alias-state.json`

## Execution Rules

- Do not run `campus-ingestion-enqueue-regulation-rag-release-candidates`.
- Do not run `campus-ingestion-process-regulation-rag-release-candidates`.
- Do not call release admission generation.
- Do not create embeddings or write Qdrant collections.
- Do not publish or unpublish serving aliases.
- Do not repair, delete, force-reenqueue or otherwise mutate candidate-store rows.
- Use current canonical/document-units artifacts as the only chunk input.

## Classification Rules

- `admit_to_chunk`: complete regulation body, current canonical cleaning
  provenance, and no known owner-body recovery gap.
- `reject`: amendment-only summary, historical notification without reusable rule
  body, owner body absent, or explicitly excluded promotion candidate.
- `needs_recovery`: likely valid regulation body but missing full owner source,
  attachment recovery, or manual target resolution evidence.

## Verification

Planning verification:

```bash
pnpm docs:lint
```

Later runtime phases must add focused Python tests or replay assertions for any
new command that writes chunk-only evidence.
