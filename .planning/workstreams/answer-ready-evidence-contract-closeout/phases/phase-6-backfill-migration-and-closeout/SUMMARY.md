---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Summary: Backfill, Migration And Closeout

Phase 6 closed the `student_rules` answer-ready evidence contract loop for the target procedure,
restriction, eligibility judgment, paper/example and category-discovery cases.

## Code Changes

- Added closeout audit coverage in `packages/evals/src/campus_evals/answer_ready_closeout_audit.py`
  and `tests/evals/answer_ready_closeout_audit_suite.py`.
- Fixed `procedure_step` condition subject inference so application/procedure intent is not
  overwritten by material cues.
- Fixed discipline relief negative evidence so `不予解除处分` is represented as
  `answer_role=exclusion_rule`, `condition_polarity=negative` and
  `condition_subject=discipline_relief_exclusion`.
- Promoted high-confidence parser roles for `exception_rule`, `exclusion_rule` and
  `example_evidence` over coarse handbook semantics where the parser provides answer-ready evidence
  shape.
- Blocked adjacent short-textual merging for atomic answer-ready evidence before final chunk metadata
  is materialized.
- Combined synthetic target clauses with the real scholarship category registry overview in closeout
  audit fixtures, so category discovery proves the registry path instead of a test-only document.

## Docs And Planning

- Updated `docs/policies/student-handbook-chunking-and-validation-policy.md` with the
  `answer_ready_evidence.v2` metadata contract and atomic evidence merge boundary.
- Updated `docs/architecture/system/retrieval-serving-architecture.md` with the release-lane
  answer-ready contract fail-close requirement.
- Added `GAP-LEDGER.md` completion audit.
- Marked the workstream completed in `README.md`, `STATE.md`, `ROADMAP.md` and
  `.planning/WORKSTREAMS.md`.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.answer_ready_closeout_audit_suite -q
```

Result: `Ran 1 test ... OK`.

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_handbook_chunking_pipeline \
  tests.ingestion.test_index_release_acceptance \
  tests.ingestion.test_registry_scope_release_acceptance_wiring \
  tests.evals.retrieval_chunk_quality_suite \
  tests.evals.answer_ready_closeout_audit_suite \
  tests.retrieval.backend_qdrant_curriculum_ranking_metadata_suite \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.agent.rag_agent_realistic_e2e_samples_suite \
  tests.agent.rag_agent_answer_quality_regression_suite -q
```

Result: `Ran 134 tests ... OK`.

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.evidence_attributes_suite \
  tests.retrieval.evidence_contract_ranking_suite \
  tests.evals.answer_ready_component_eval_suite \
  tests.agent.rag_agent_typed_answer_drafts_suite -q
```

Result: `Ran 20 tests ... OK`.

```bash
pnpm docs:lint
```

Result: `Summary: 0 error(s)`.

```bash
uv run --all-packages ruff check \
  packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py \
  packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py \
  packages/ingestion-core/src/campus_ingestion_core/process_candidate_aggregation.py \
  packages/ingestion-core/src/campus_ingestion_core/process_candidate_merging_short_textual.py \
  packages/evals/src/campus_evals/answer_ready_closeout_audit.py \
  tests/evals/answer_ready_closeout_audit_suite.py
```

Result: `All checks passed!`.

```bash
uv run --all-packages ruff format \
  packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py \
  packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py \
  packages/ingestion-core/src/campus_ingestion_core/process_candidate_aggregation.py \
  packages/ingestion-core/src/campus_ingestion_core/process_candidate_merging_short_textual.py \
  packages/evals/src/campus_evals/answer_ready_closeout_audit.py \
  tests/evals/answer_ready_closeout_audit_suite.py --check
```

Result: `6 files already formatted`.

## Closeout Boundary

This phase proves the current worktree contract and regression behavior. It does not claim that a
production serving alias has already been rebuilt or switched. Real backfill/publish must still use
the regulation RAG release lane and a release admission manifest with
`answer_ready_contract_status=passed`.

`institutional_rules` full adoption is not a blocker for this workstream. The shared regulation
chunker can be reused, but complete fail-close adoption should be handled by a future workstream if
that collection requires the same answer-ready contract gate.
