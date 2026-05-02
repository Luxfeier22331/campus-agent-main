---
doc_type: plan
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 7: Phase 13 Backfill Release Admission

## Goal

Admit the Phase 13 historical regulation canonical backfill output into the
regulation RAG release lane and prove the downstream behavior with real operator
candidate state.

## Scope

- Add an ingestion-worker CLI that enqueues regulation RAG release candidates from
  a materialization report or explicit selected document ids.
- Process the Phase 13 materialization report through the release lane.
- Keep `scoped_rules` non-serving while its runtime profile remains not
  query-enabled by default.
- Publish current `institutional_rules` only through the collection-scope release
  executor, acceptance fixture, qrels coverage gate and post-publish audit.
- Fix any release-lane defects exposed by the real replay.

## Acceptance

- Phase 13 report creates 10 candidates: 2 `institutional_rules` and 8
  `scoped_rules`.
- The 8 `scoped_rules` candidates reach `not_query_enabled`, not a current serving
  alias.
- The 2 `institutional_rules` candidates share one collection-scope release and
  reach `serving_published`.
- Post-publish audit accepts absent Qdrant payload fields when the expected release
  metadata value is `null`, while still rejecting missing non-null metadata fields.
- Focused release/audit/lane/worker/eval tests pass.

## Evidence Targets

- `../../evidence/phase-07-phase13-backfill-release-admission/enqueue-phase13-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/process-phase13-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/reenqueue-institutional-current-scope-after-audit-fix-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/process-institutional-current-scope-after-audit-fix-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/candidate-status-after-audit-fix.json`
