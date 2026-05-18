---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Summary: Phase 13 Backfill Release Admission

## Outcome

Phase 13 historical regulation canonical backfill targets were admitted into the
regulation RAG release lane.

The initial replay created 10 candidates and processed all of them:

- 2 `institutional_rules`
- 8 `scoped_rules`

The `scoped_rules` candidates reached `not_query_enabled`, which is the expected
behavior while `regulations/scoped_rules` is retrieval-ready but not default
query-serving.

The `institutional_rules` candidates initially exposed two real release-lane
gaps:

- collection-scope release work must be shared for multiple pending candidates in
  the same collection
- post-publish payload audit must not require fields whose expected release
  metadata value is `null`, because Qdrant does not persist null payload fields

Both gaps are now covered by tests. After re-enqueueing the two institutional
candidates, the current scope release completed and both candidates reached
`serving_published` with `ragVerificationStatus=passed`.

Final status summary:

- `institutional_rules:serving_published`: 2
- `scoped_rules:not_query_enabled`: 8

## Evidence

- `../../evidence/phase-07-phase13-backfill-release-admission/enqueue-phase13-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/process-phase13-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/reenqueue-institutional-current-scope-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/process-institutional-current-scope-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/reenqueue-institutional-current-scope-after-audit-fix-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/process-institutional-current-scope-after-audit-fix-report.json`
- `../../evidence/phase-07-phase13-backfill-release-admission/candidate-status-after-audit-fix.json`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_registry_scope_release \
  tests.ingestion.test_registry_scope_release_acceptance_wiring \
  tests.ingestion.test_regulation_rag_release_lane \
  tests.ingestion.test_enqueue_regulation_rag_release_candidates_worker \
  tests.ingestion.test_process_regulation_rag_release_candidates_worker \
  tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite \
  -v
```

Result: 52 tests passed.

Real replay commands executed:

```bash
uv run --all-packages campus-ingestion-enqueue-regulation-rag-release-candidates \
  --collection institutional_rules \
  --document-id 'institutional_regulation:muc:中央民族大学毕业生就业奖励办法:f16e569519f7' \
  --document-id 'institutional_regulation:muc:中央民族大学学生社团管理办法:7da72ac3d796' \
  --output .planning/workstreams/regulation-rag-release-lane/evidence/phase-07-phase13-backfill-release-admission/reenqueue-institutional-current-scope-after-audit-fix-report.json

uv run --all-packages campus-ingestion-process-regulation-rag-release-candidates \
  --acceptance-case-path packages/evals/fixtures/institutional_rules_release_acceptance.v1.json \
  --candidate-id rag_release_candidate:262e29e00b50c3c889d17dba0cdcb5860293d1f33a6b62681f523a1d1c3c543b \
  --candidate-id rag_release_candidate:a88613f345e9ad498f6e64ac13b250a5ce04e076478ba369177f463890a36b33
```
