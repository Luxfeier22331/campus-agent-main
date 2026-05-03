---
doc_type: state
status: completed
workstream: institutional-rules-retrieval-quality-baseline
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# State: Institutional Rules Retrieval Quality Baseline

## Current Position

- status: `completed`
- current phase: `Phase 00 golden dataset v1 completed; 42-document fixture refresh applied`
- last activity: 2026-05-03
- next phase: none unless reopen rule is hit

## Completed Scope

- `packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json`
  now contains 89 regression-locked cases:
  - 84 positive institutional consumption cases
  - 5 no-hit / hard-negative guards
- `packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json`
  covers all 42 admitted校级 institutional rule titles.
- `configs/ingestion/regulations/institutional_rules/runtime-profile.json`
  enables `no_hit_min_top_score=0.6` and `no_hit_min_score_gap=0.1`.
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_no_hit_policy.py`
  now has institutional title-intent no-hit support to reject low-confidence title decoys.
- The 12 selected school-level re-admitted regulations use
  `regulations/institutional_rules` document ids and Phase 42 v9
  chunk-preparation semantic `version_id`s.

## Evidence Summary

- Golden oracle for the original 30-document set: 64/64.
- Live retrieval after policy fix:
  - total cases: 64
  - hit@1: 1.0
  - doc_hit@1: 1.0
  - doc_hit@3: 1.0
  - forbidden_hit_rate: 0.0
  - failed cases: 0
- Hard-negative / no-hit guards:
  - `institutional-golden-hard-negative-travel-expense-unreleased`: empty retrieved sources
  - `institutional-golden-hard-negative-annual-postgraduate-recommendation-2026`:
    repo-tracked guard for the excluded annual/cohort rule
  - `institutional-golden-scoped-rule-decoy-history-school`: empty retrieved sources
  - `institutional-golden-no-hit-spaceport-regulation`: empty retrieved sources
  - `institutional-golden-no-hit-fictional-office`: empty retrieved sources
- Answer quality contract:
  - total: 42 repo-tracked cases
  - original live/observation-backed pass evidence: 30/30
  - failed: 0

## Verification Commands

```bash
uv run --all-packages python -m unittest tests.retrieval.backend_qdrant_no_hit_suite -v
```

Observed result: `Ran 10 tests ... OK`.

```bash
uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
  --qrels packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json \
  --output .planning/workstreams/institutional-rules-retrieval-quality-baseline/evidence/phase-00-golden-dataset-v1/golden-live-run.after-policy-fix.json \
  --format json \
  --top-k 3
```

Observed result for the original 30-document set: `total_cases=64`, `hit@1=1.0`,
`doc_hit@1=1.0`, `doc_hit@3=1.0`, `forbidden_hit_rate=0.0`.

## Boundary

院级 `scoped_rules` 继续不进入默认文档站或 RAG consumption。它只作为 decoy / negative
guard 出现在本线质量验证中。
