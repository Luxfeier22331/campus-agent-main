---
doc_type: phase_summary
status: completed
workstream: regulation-rag-release-lane
phase: phase-08-release-admission-hardening
created: 2026-05-02
updated: 2026-05-02
---
# Phase 8 Summary: Release Admission Hardening

## Outcome

Query-enabled `regulations/*` RAG release now fails closed unless a matching
`regulation_rag_release_admission.v1` manifest proves canonical identity,
reader publication, chunk preparation, qrels/eval coverage and authz-deny
evidence for the exact registry scope being released.

The prior suspect `institutional_rules` release was contained and replayed
through the candidate processor after admission proof was generated.

## Implemented

- Added release admission schema, validation and release gating in
  `ingestion-core`.
- Added `release_admission_blocked` candidate terminal status.
- Required candidate processor success to carry admission proof before writing
  `serving_published`.
- Added guarded scope alias containment with expected-current alias matching.
- Added explicit `--force` reenqueue for unchanged `serving_published`
  candidates when release policy/admission gates change.
- Registered `campus-ingestion-scope-alias` console entry point.
- Updated architecture/workstream docs to keep document-site reader publish
  separate from RAG query serving.

## Runtime Evidence

- Suspect release contained:
  `../../evidence/phase-08-release-admission-hardening/suspect-release-containment-report.json`
- Reader assets published:
  `../../evidence/phase-08-release-admission-hardening/institutional-reader-publish-report.json`
- Chunks prepared:
  `../../evidence/phase-08-release-admission-hardening/institutional-chunk-preparation-report.json`
- Release admission generated:
  `../../evidence/phase-08-release-admission-hardening/institutional-release-admission-report.json`
- Forced reenqueue completed:
  `../../evidence/phase-08-release-admission-hardening/institutional-force-reenqueue-report.json`
- Processor replay completed:
  `../../evidence/phase-08-release-admission-hardening/institutional-process-forced-candidates-report.json`
- Final alias and candidate state:
  `../../evidence/phase-08-release-admission-hardening/institutional-final-candidate-alias-state.json`

## Final State

- `institutional_rules` alias target:
  `institutional_rules__r20260502_030502_882844_ba991c97`
- point count: 79
- `institutional_rules:serving_published`: 2
- `scoped_rules:not_query_enabled`: 8
- target institutional candidates now carry
  `candidate_reason=forced_release_policy_reenqueue` and
  `last_release_id=r20260502_030502_882844_ba991c97`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_regulation_rag_release_lane \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_process_regulation_rag_release_candidates_worker \
  tests.ingestion.test_release_registry_scope_worker \
  tests.ingestion.test_scope_alias \
  tests.ingestion.test_scope_alias_worker
```
