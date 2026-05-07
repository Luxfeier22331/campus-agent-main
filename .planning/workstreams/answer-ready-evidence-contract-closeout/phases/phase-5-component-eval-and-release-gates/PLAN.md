---
doc_type: plan
status: planned
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Component Eval And Release Gates

## Goal

Make answer-ready evidence failures diagnosable at component level and fail closed during
chunk/release quality gates.

## Tasks

1. Implement the Phase 0 component eval contract.
   - Use `EVAL-CONTRACT.md` as the frozen schema instead of redesigning case fields in this phase.
   - Required case fields include expected intent, query polarity, answer role, condition subject,
     document ids or category coverage, top evidence roles, draft kind and grounding support.
   - Failure classes must match Phase 0: `intent_mismatch`, `retrieval_miss`,
     `ranking_mismatch`, `selection_not_answer_ready`, `draft_contract_mismatch`,
     `grounding_mismatch` and `chunk_contract_missing`.
2. Implement component assertions.
   - Intent classification assertion.
   - Retrieval target/coverage assertion.
   - Ranking top source assertion.
   - Supporting evidence answer-readiness assertion.
   - Typed draft assertion.
   - Grounding assertion.
3. Extend chunk quality gate.
   - Missing answer role.
   - Missing condition subject for judgment clauses.
   - Missing procedure typed fields for procedure chunks.
   - Missing category overview member metadata.
   - Missing parent context.
4. Extend release acceptance.
   - Query-enabled `student_rules` release fails closed if answer-ready contract gate fails.
   - Wire the gate into the Phase 0 chosen hook:
     `registry_scope_release.publish_scope_release -> evaluate_release_chunk_quality`.
   - Extend `regulation_rag_release_admission` manifest shape/validation so answer-ready gate status
     is recorded and validated.
   - Required test owner is `tests/ingestion/test_index_release_acceptance.py` plus release-lane
     wiring tests where needed.
   - Existing qrels remain compatible.
5. Add reporting.
   - Report failure class: `intent_mismatch`, `retrieval_miss`, `ranking_mismatch`,
     `selection_not_answer_ready`, `draft_contract_mismatch`, `grounding_mismatch`,
     `chunk_contract_missing`.

## Acceptance

- Each target fuzzy/formal sample can report the failing component.
- Chunk quality gate catches missing answer-ready fields before indexing.
- Release acceptance cannot publish query-serving `student_rules` with missing required evidence
  contract fields.
- The fail-close test exercises the same release-admission path used to admit/switch a regulation
  RAG release, not only the standalone chunk quality evaluator.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.retrieval_chunk_quality_suite \
  tests.evals.retrieval_benchmark_hybrid_fixture_suite \
  tests.evals.multi_agent_product_path_eval_gate_profile_suite \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release_acceptance_wiring \
  tests.agent.rag_agent_realistic_e2e_samples_suite -q
uv run --all-packages ruff check packages/evals packages/rag-agent packages/ingestion-core tests/evals tests/agent
```
