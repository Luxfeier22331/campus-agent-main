---
doc_type: phase_plan
status: completed
workstream: regulation-rag-release-lane
phase: phase-10-institutional-rag-consumption
created: 2026-05-03
updated: 2026-05-03
---
# Phase 10 Plan: Institutional RAG Consumption Acceptance

## Goal

Validate that the 30 published校级 `regulations/institutional_rules` documents
are ready for downstream RAG consumption after alias publish.

## Scope

- Cover only the released校级 `institutional_rules` scope.
- Keep院级 `scoped_rules` outside document-site/RAG default consumption.
- Validate retrieval with current authz projection and version-locked qrels.
- Add a deterministic answer-consumption shell that checks source identity and
  prevents scoped-rule evidence from satisfying institutional-rule answers.

## Steps

- Expand `institutional_rules_retrieval_qrels.json` to 30 title-exact release-gate
  cases plus semantic, authz-deny and no-hit guards.
- Replace the institutional retrieval eval manifest with all 30 current release
  documents and version ids.
- Keep release acceptance aligned with the same 33 retrieval cases.
- Extend answer-quality contract cases to require concrete source title / URL
  identity and forbid scoped-rule source identity.
- Run live retrieval against the current `institutional_rules` alias.
- Record benchmark summary and answer-contract evidence.

## Verification

```bash
uv run --all-packages python -m campus_evals.retrieval_live_benchmark \
  --qrels packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
  --output .planning/workstreams/regulation-rag-release-lane/evidence/phase-10-institutional-rag-consumption/retrieval-live-run.json \
  --format json \
  --top-k 3

uv run --all-packages python -m campus_evals.retrieval_benchmark \
  --qrels packages/evals/fixtures/institutional_rules_retrieval_qrels.json \
  --results .planning/workstreams/regulation-rag-release-lane/evidence/phase-10-institutional-rag-consumption/retrieval-live-run.json \
  --format json

uv run --all-packages python -m campus_evals.answer_quality_contract accept \
  --cases-path packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json \
  --observations-path .planning/workstreams/regulation-rag-release-lane/evidence/phase-10-institutional-rag-consumption/institutional-answer-quality-observations.json \
  --output-dir .planning/workstreams/regulation-rag-release-lane/evidence/phase-10-institutional-rag-consumption/answer-quality-contract \
  --json
```
