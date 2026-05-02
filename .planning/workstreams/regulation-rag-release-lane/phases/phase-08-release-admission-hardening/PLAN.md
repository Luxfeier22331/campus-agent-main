---
doc_type: phase_plan
status: in_progress
workstream: regulation-rag-release-lane
phase: phase-08-release-admission-hardening
created: 2026-05-02
updated: 2026-05-02
---
# Phase 8: Release Admission Hardening

## Goal

Make query-enabled regulation RAG release fail closed unless a scope-level
`regulation_rag_release_admission.v1` manifest proves the current canonical,
reader, chunk, qrels/eval and authz evidence matches the exact document versions
being released.

## Required Changes

- Add `release_admission_blocked` as a candidate terminal status.
- Add admission manifest schema and validation in `ingestion-core`.
- Require admission manifest before `release_registry_scope` can publish
  query-enabled `regulations/*`.
- Require release executor success to carry admission proof before candidate
  processor writes `serving_published`.
- Keep `scoped_rules` query-disabled and non-serving.
- Add containment support for suspect releases: unpublish only when the alias still
  points to the expected suspect physical collection.
- Update target architecture and retrieval serving docs so document-site publish
  remains separate from RAG query serving.

## Suspect Release

The Phase 13 institutional release
`r20260502_020250_873774_266f68e9` is treated as suspect until matching admission
proof is generated and replayed.

Containment command shape:

```bash
uv run --all-packages campus-ingestion-scope-alias \
  --corpus regulations \
  --collection institutional_rules \
  --unpublish \
  --expected-current-physical-collection-name institutional_rules__r20260502_020250_873774_266f68e9 \
  --action-reason unadmitted_release_containment
```

## Verification

Focused verification:

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_regulation_rag_release_lane \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_process_regulation_rag_release_candidates_worker \
  tests.ingestion.test_release_registry_scope_worker \
  tests.ingestion.test_scope_alias \
  tests.ingestion.test_scope_alias_worker
```
