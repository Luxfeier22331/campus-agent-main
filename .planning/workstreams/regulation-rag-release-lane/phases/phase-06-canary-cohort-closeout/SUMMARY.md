---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Summary: Canary Cohort Closeout

## Outcome

Closed the canary cohort and fixed the exposed lifecycle gap:

- current institutional rule can proceed to `serving_published`
- real selected scoped-rule samples `351907` and `186977` are non-current
  `source-faithful` records and reach `held_search_only`
- source-truth-only negative notice creates no RAG release candidate

The current institutional canary uses `355282` because it has an attachment-backed
semantic owner body. `187233` is not used as the serving canary: it is a revision
notice for `中央民族大学采购工作管理办法`, but the notice body alone does not prove a
complete owner body for the regulation.

The selected replay also aligned the `355282` RAG eval/release identity with the
materialized target id:

- `institutional_regulation:muc:中央民族大学关于学生使用人工智能的指导意见:089bcf7907da`

The important correction is that non-current historical/search-only candidates are
not equivalent to withdrawn/deleted documents. They must not trigger current alias
cleanup unless the document status is actually withdrawn or deleted.

## Evidence

- `./evidence/phase-06-canary-cohort-closeout/canary-status-summary.json`
- `./evidence/phase-06-canary-cohort-closeout/selected-replay-dry-run.json`

```bash
uv run --all-packages campus-ingestion-generate-regulation-rag-release-selected-replay

uv run --all-packages python -m unittest \
  tests.ingestion.test_regulation_rag_release_lane.RegulationRagReleaseLaneTest.test_phase_6_canary_cohort_closeout_states \
  tests.ingestion.test_regulation_rag_release_lane.RegulationRagReleaseLaneTest.test_phase_6_selected_replay_evidence_matches_real_sample_expectations \
  tests.ingestion.test_regulation_rag_release_lane.RegulationRagReleaseLaneTest.test_withdrawn_current_rule_generates_delete_terminal_state \
  -v
```

## Next

The workstream is implementation-complete. Remaining operational work is ordinary
commit/archive handling, not additional feature implementation.
