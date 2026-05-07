---
doc_type: gap_ledger
status: active
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Answer-Ready Semantic Extraction Rearchitecture

This ledger tracks planned and closed debt for the active workstream. Each phase must update this
file with evidence links, status and command output references before the workstream can close.

## Debt Ledger

| Gap | Target Resolution | Owner Phase | Status |
|-----|-------------------|-------------|--------|
| semantic correctness has no frozen oracle | Phase 0 gold matrix maps sample -> intent / answer role / subject / polarity / group / draft / grounding expectation | Phase 0, Phase 8 | phase0_closed |
| release adoption proof can stay abstract | Phase 0 binds concrete release/admission/alias commands and required artifact fields for Phase 9/10 | Phase 0, Phase 9, Phase 10 | phase0_closed |
| taxonomy values can grow without governance | admission rules, alias review, unknown handling and release invalidation policy | Phase 0, Phase 2 | phase0_closed |
| static release gates and query-conditioned checks are mixed | static metadata validation remains release admission; query-conditioned contradictions move to retrieval/component eval | Phase 0, Phase 5, Phase 6, Phase 8 | phase0_closed |
| `condition_subject` extraction still has heuristic lineage | shared taxonomy owner is now established in `packages/shared`; shared resolver now canonicalizes explicit aliases and emits provenance, but Phase 4 still needs structured-unit driven production that removes remaining ingestion-private cue chains | Phase 2, Phase 4 | phase2_owner_normalized_phase4_shared_assignment_started |
| `condition_group_id` lacks stable production chain | repeated eligibility-group intros under one parent now emit stable `condition_group_key` / `condition_group_id`, `clause_unit_id` now propagates through ingestion/shared/retrieval with fail-closed validation for clause-labeled answer-ready chunks, single enumerated clauses with inline example tails now split into child units, standalone single-clause answer-ready units now keep child identity instead of falling back as one degraded chunk, and shared-scope sibling atomic clauses now preserve inherited positive/negative role semantics across the same intro scope; full clause-level parent-child grouping still needs broader structured-unit coverage and tighter grouped-segment cleanup beyond the current repeated-intro + clause-id + inline-tail + single-clause + shared-scope sibling fixes | Phase 3, Phase 4 | phase3_group_key_clause_id_inline_tail_single_clause_and_shared_scope_siblings_started_phase4_partial_production |
| typed eligibility intro is not a grouping contract | Phase 1 freezes intro contract fields and validation; Phase 4 now produces intro fields for tested slices, but grouping still derives from inference rather than stable clause/parent-child structure | Phase 1, Phase 4 | phase1_contract_closed_phase4_partial_production |
| procedure step semantics still mix cue parsing and typed fields | shared procedure action taxonomy owner is now established; shared resolver now handles metadata-first and canonical action assignment, but Phase 4 still needs structured production to eliminate remaining cue-driven fallback | Phase 2, Phase 4 | phase2_owner_normalized_phase4_shared_assignment_started |
| category overview is not generalized across regulation categories | shared category registry now owns generalized `student_rules` category definitions and supports multi-category overview emission; Phase 4 has reusable category overview contract production, but broader production proof and release-lane evidence remain open | Phase 2, Phase 4 | phase2_registry_owner_closed_phase4_partial_production |
| chunk quality gate checks defects more than semantic correctness | Phase 5 now emits structured release-gate evidence (`answer_ready_contract_version`, required-field failures, semantic failures, fallback budget status), admission manifests carry those fields forward, and multiple query-independent semantic consistency rules are enforced (`answer_ready_polarity_role_conflict`, `answer_ready_intro_answer_bearing_conflict`, `answer_ready_condition_subject_role_conflict`, `answer_ready_procedure_action_role_conflict`); broader static consistency checks are still incomplete | Phase 5 | phase5_gate_outputs_and_static_consistency_expanded |
| retrieval can still use text cues as primary signal | fallback budget zero for target v3 releases; old-index-only quarantine | Phase 6, Phase 11 | planned |
| typed answer support can drift from evidence contract | typed answer drafts grounded through one claim/evidence graph | Phase 7 | planned |
| final E2E hides component failure stage | component eval panel with extraction/retrieval/ranking/selection/draft/grounding/release attribution | Phase 8 | planned |
| `student_rules` lacks v3 rebuilt release evidence | rebuild through regulation RAG release lane with acceptance and alias evidence | Phase 9 | planned |
| `institutional_rules` lacks v3 rebuilt release evidence | rebuild through regulation RAG release lane with acceptance and alias evidence; early extraction denominator is now partially covered because institutional procedure lists go through answer-ready child-step chunking and typed procedure metadata instead of compatibility-only single-clause proof, but release-lane adoption evidence is still open | Phase 4, Phase 10 | phase4_institutional_procedure_denominator_started_phase10_planned |
| legacy compatibility can leak into target completion | legacy old-index lane isolated, observable and excluded from completion | Phase 11 | planned |

## Completion Audit

Phase 0 evidence:

- `phases/phase-00-scope-inventory-and-done-definition-freeze/INVENTORY.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/DONE-DEFINITION.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/FALLBACK-BUDGET.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/RELEASE-ADOPTION-PROOF.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/SEMANTIC-ORACLE.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/RELEASE-LANE-ENTRYPOINTS.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/TAXONOMY-ADMISSION.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/INSTITUTIONAL-DENOMINATOR.md`
- `phases/phase-00-scope-inventory-and-done-definition-freeze/STATIC-VS-QUERY-GATES.md`

Later phase summaries must add:

- changed files
- verification commands and outcomes
- release manifest or audit artifact paths
- fallback usage reports
- component eval reports
- explicit remaining gaps, if any

Phase 1 evidence:

- `phases/phase-01-contract-v3-and-schema-governance/SUMMARY.md`
- `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
- `packages/shared/src/campus_shared/__init__.py`
- `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py`
- `tests/shared/test_answer_ready_evidence_contract.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`

Phase 2 evidence so far:

- `packages/shared/src/campus_shared/regulation_semantic_registry.py`
- `packages/shared/src/campus_shared/__init__.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_semantics.py`
- `packages/ingestion-core/src/campus_ingestion_core/process_candidate_postprocess.py`
- `packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py`
- `tests/shared/test_regulation_semantic_registry.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`
- verification:
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.agent.rag_agent_handbook_category_discovery_suite -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/__init__.py packages/ingestion-core/src/campus_ingestion_core/regulation_semantics.py packages/ingestion-core/src/campus_ingestion_core/process_candidate_postprocess.py packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/__init__.py packages/ingestion-core/src/campus_ingestion_core/regulation_semantics.py packages/ingestion-core/src/campus_ingestion_core/process_candidate_postprocess.py packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py --check`

Phase 4 evidence so far:

- `packages/shared/src/campus_shared/regulation_semantic_registry.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
- `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py`
- `tests/shared/test_regulation_semantic_registry.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`
- `tests/evals/retrieval_chunk_quality_suite.py`
- verification:
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.evals.retrieval_chunk_quality_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/evals/retrieval_chunk_quality_suite.py --check`

Phase 3 evidence started:

- `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
- `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
- `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`
- `tests/shared/test_answer_ready_evidence_contract.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`
- `tests/retrieval/evidence_attributes_suite.py`
- `tests/evals/retrieval_chunk_quality_suite.py`
- verification:
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_same_parent_multiple_rank_groups_emit_distinct_condition_group_ids -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.evals.retrieval_chunk_quality_suite tests.shared.test_answer_ready_evidence_contract -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.retrieval.evidence_attributes_suite -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.evals.retrieval_chunk_quality_suite tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite -q`
  - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.evals.retrieval_chunk_quality_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_index_release_acceptance tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_attributes_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_attributes_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py --check`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py`

Phase 5 evidence started:

- `packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py`
- `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
- `tests/ingestion/test_index_release_acceptance.py`
- `tests/ingestion/test_registry_scope_release_acceptance_wiring.py`
- `tests/shared/test_answer_ready_evidence_contract.py`
- verification:
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_index_release_acceptance -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/test_index_release_acceptance.py tests/ingestion/test_registry_scope_release_acceptance_wiring.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_attributes_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/test_index_release_acceptance.py tests/ingestion/test_registry_scope_release_acceptance_wiring.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_attributes_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py --check`
