---
doc_type: phase_plan
status: completed
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
- Add explicit forced reenqueue for unchanged `serving_published` candidates when
  a release policy/admission gate change requires replay through the processor.
- Update target architecture and retrieval serving docs so document-site publish
  remains separate from RAG query serving.

## Suspect Release

The Phase 13 institutional release
`r20260502_020250_873774_266f68e9` was treated as suspect because it reached
`serving_published` before matching admission proof was required.

Containment command shape:

```bash
uv run --all-packages campus-ingestion-scope-alias \
  --corpus regulations \
  --collection institutional_rules \
  --unpublish \
  --expected-current-physical-collection-name institutional_rules__r20260502_020250_873774_266f68e9 \
  --action-reason unadmitted_release_containment
```

Closeout replay:

```bash
uv run --all-packages campus-ingestion-enqueue-regulation-rag-release-candidates \
  --collection institutional_rules \
  --document-id institutional_regulation:muc:中央民族大学学生社团管理办法:7da72ac3d796 \
  --document-id institutional_regulation:muc:中央民族大学毕业生就业奖励办法:f16e569519f7 \
  --force

INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B EMBEDDING_MODEL=Qwen3-Embedding-4B \
  uv run --all-packages campus-ingestion-process-regulation-rag-release-candidates \
    --release-admission-manifest-key regulations/operations/regulation-rag-release-admission/phase08-institutional-release-admission/institutional_rules/release-admission.json \
    --acceptance-case-path packages/evals/fixtures/institutional_rules_release_acceptance.v1.json
```

Final admitted release:

- release id: `r20260502_030502_882844_ba991c97`
- alias target: `institutional_rules__r20260502_030502_882844_ba991c97`
- point count: 79
- candidate status summary: 2 `institutional_rules:serving_published`, 8
  `scoped_rules:not_query_enabled`

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

Runtime evidence:

- `../../evidence/phase-08-release-admission-hardening/suspect-release-containment-report.json`
- `../../evidence/phase-08-release-admission-hardening/institutional-release-admission-report.json`
- `../../evidence/phase-08-release-admission-hardening/institutional-force-reenqueue-report.json`
- `../../evidence/phase-08-release-admission-hardening/institutional-process-forced-candidates-report.json`
- `../../evidence/phase-08-release-admission-hardening/institutional-final-candidate-alias-state.json`
