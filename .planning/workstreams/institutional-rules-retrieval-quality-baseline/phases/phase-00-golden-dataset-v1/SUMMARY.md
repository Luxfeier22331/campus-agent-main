---
doc_type: summary
status: completed
workstream: institutional-rules-retrieval-quality-baseline
phase: phase-00-golden-dataset-v1
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 00 Golden Dataset v1

## Result

Phase 00 completed the institutional rules quality baseline for the original released 30校级
`regulations/institutional_rules`. The tracked fixture set has since been refreshed to cover
42 admitted校级 institutional rules after 12 selected school-level regulations were explicitly
re-admitted.

## Deliverables

- `packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json`
  with 89 regression-locked cases.
- `packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json`
  with 42 released-title answer source identity cases.
- `configs/ingestion/regulations/institutional_rules/runtime-profile.json`
  no-hit guard thresholds.
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_no_hit_policy.py`
  institutional title-intent no-hit support.
- `tests/retrieval/backend_qdrant_no_hit_suite.py` live-like hard-negative coverage.

## Evidence

- `golden-oracle-summary.json`: 64/64 oracle retrieval success for the original 30-document set.
- `golden-live-summary.after-policy-fix.json`: 64 total cases, `hit@1=1.0`,
  `doc_hit@1=1.0`, `doc_hit@3=1.0`, `forbidden_hit_rate=0.0`.
- `golden-live-run.after-policy-fix.json`: final four no-hit / hard-negative guards have
  empty `retrieved_sources`.
- `answer-quality-contract.json`: 30 total, 30 passed, 0 failed for the original live-backed
  answer source-identity observations.

## Notes

The no-hit root cause was lexical support that was too broad for institutional title-intent
queries. Live chunks containing words such as `差旅费`, `硕博连读`, or `实验室` were accepted even
when the retrieved document title was a different school-level regulation. The fix is scoped to
`regulations/institutional_rules` title-intent queries and does not admit `scoped_rules` into
default consumption.
