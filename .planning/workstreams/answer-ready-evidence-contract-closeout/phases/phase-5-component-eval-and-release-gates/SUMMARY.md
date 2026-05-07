---
doc_type: phase_summary
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Summary: Component Eval And Release Gates

Phase 5 added component-level answer-ready evaluation and fail-close release gates for
query-serving `student_rules` chunks.

## Artifacts

- `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py`
- `packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py`
- `packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py`
- `packages/evals/src/campus_evals/answer_ready_component_eval.py`
- `packages/evals/src/campus_evals/retrieval_chunk_quality.py`
- `tests/evals/answer_ready_component_eval_suite.py`
- `tests/evals/retrieval_chunk_quality_suite.py`
- `tests/ingestion/test_index_release_acceptance.py`
- `tests/ingestion/test_registry_scope_release_acceptance_wiring.py`

## Code Changes

- Added shared answer-ready metadata checks for query-serving `regulations/student_rules` chunks.
- Extended chunk quality gates to flag:
  - missing answer-ready contract version
  - missing parent unit context
  - missing condition subject for judgment/condition evidence
  - missing typed procedure fields for procedure evidence
  - missing category overview member document ids or titles
- Extended release quality summary with:
  - `answer_ready_contract_status`
  - `answer_ready_contract_issue_count`
  - `failure_classes=("chunk_contract_missing",)` when required contract fields are absent.
- Extended `regulation_rag_release_admission` to policy v2 and to validate
  `answer_ready_contract_status == "passed"`.
- Kept public `EvidenceSource`, supervisor contracts, SDK tool schemas and serving surfaces
  unchanged.
- Added component eval support for Phase 0 failure classes:
  - `intent_mismatch`
  - `retrieval_miss`
  - `ranking_mismatch`
  - `selection_not_answer_ready`
  - `draft_contract_mismatch`
  - `grounding_mismatch`

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.evals.retrieval_chunk_quality_suite \
  tests.evals.answer_ready_component_eval_suite \
  tests.evals.retrieval_benchmark_hybrid_fixture_suite \
  tests.evals.multi_agent_product_path_eval_gate_profile_suite \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release_acceptance_wiring \
  tests.agent.rag_agent_realistic_e2e_samples_suite -q
```

Result: `Ran 98 tests ... OK`.

```bash
uv run --all-packages ruff check \
  packages/evals/src/campus_evals/answer_ready_component_eval.py \
  packages/evals/src/campus_evals/retrieval_chunk_quality.py \
  packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py \
  packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py \
  packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py \
  tests/evals/answer_ready_component_eval_suite.py \
  tests/evals/retrieval_chunk_quality_suite.py \
  tests/ingestion/test_index_release_acceptance.py \
  tests/ingestion/test_registry_scope_release_acceptance_wiring.py \
  tests/ingestion/test_admit_regulation_rag_release_worker.py
```

Result: `All checks passed!`.

Plan-level broad ruff command still fails on pre-existing or unrelated lint findings in
`packages/evals/src/campus_evals/contact_directory_lookup_release_gate.py`,
`packages/evals/src/campus_evals/official_web_selected_write_preview_runtime_verifier.py`,
`packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`,
`packages/ingestion-core/src/campus_ingestion_core/__init__.py`,
`packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py`,
`tests/evals/retrieval_benchmark_test_support.py` and
`tests/evals/service_guide_lookup_release_gate_suite.py`.

## Follow-Up For Phase 6

- Rebuild or backfill admitted `student_rules` chunks with the answer-ready contract fields.
- Run targeted real-sample review against rebuilt chunks and confirm typed metadata is the primary
  ranking/selection signal.
- Decide or seed institutional-rules adoption after student-rules migration evidence exists.
