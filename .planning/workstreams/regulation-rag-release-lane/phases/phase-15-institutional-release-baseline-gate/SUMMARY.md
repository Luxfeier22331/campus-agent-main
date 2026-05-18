---
doc_type: phase_summary
status: completed
workstream: regulation-rag-release-lane
phase: phase-15-institutional-release-baseline-gate
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 15 Summary: Institutional Release Baseline Gate

## Outcome

Phase 15 converted the 42-document `institutional_rules` acceptance checklist
from scattered commands into one repo-owned gate:

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile institutional-rules-release-baseline \
  --observations-path <institutional-answer-observations.json>
```

The gate is intentionally local/release-manual rather than GitHub workflow
dispatchable because it requires the current Qdrant alias, embedding env and
local supervisor product-path smoke runtime.

## Gate Coverage

- Release retrieval live qrels:
  `packages/evals/fixtures/institutional_rules_retrieval_qrels.json`
- Golden retrieval live qrels:
  `packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json`
- Institutional answer-quality contract:
  `packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json`
- Qdrant no-hit policy suite:
  `tests.retrieval.backend_qdrant_no_hit_suite`
- Supervisor product-path smoke:
  `rag_delegate_institutional_rules`

## Evidence

- `../../evidence/phase-15-institutional-release-baseline-gate/institutional-rules-release-baseline-gate.json`
- `../../evidence/phase-15-institutional-release-baseline-gate/retrieval-live-run.json`
- `../../evidence/phase-15-institutional-release-baseline-gate/golden-retrieval-live-run.json`
- `../../evidence/phase-15-institutional-release-baseline-gate/answer-quality-contract/profile-report.json`
- `../../evidence/phase-15-institutional-release-baseline-gate/product-path-smoke/process-smoke-summary.json`

## Counts

- Gate checks: 5
- Gate checks passed: 5
- Gate checks failed: 0
- Release retrieval cases: 45
- Release retrieval doc_hit@1: 1.0
- Release retrieval doc_recall@5: 1.0
- Release retrieval forbidden_hit_rate: 0.0
- Golden retrieval cases: 89
- Golden retrieval doc_hit@1: 1.0
- Golden retrieval doc_recall@5: 1.0
- Golden retrieval forbidden_hit_rate: 0.0
- Answer-quality cases: 42
- Answer-quality passed: 42
- Product-path smoke profile: `rag_delegate_institutional_rules`
- Product-path smoke passed: true

## Boundary

- This phase does not admit new regulation documents.
- This phase does not republish the `institutional_rules` serving alias.
- `scoped_rules`, annual/cohort rules and college-level rules remain outside
  default `institutional_rules` consumption.
