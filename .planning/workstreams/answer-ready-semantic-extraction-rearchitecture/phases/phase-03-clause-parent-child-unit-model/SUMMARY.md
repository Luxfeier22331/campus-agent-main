---
doc_type: phase_summary
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 3 Clause Parent-Child Unit Model

## Result

Phase 3 now has explicit completion-audit evidence instead of scattered test references. The
planned clause-level / parent-child unit model is covered across handbook-style clauses,
institutional regulations, grouped intros, inline example tails, repeated groups and retrieval-side
attribute projection.

This summary records audit proof for the Phase 3 plan. The overall workstream remains active under
Phase 11 closeout.

## Evidence Surfaces

- implementation:
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
  - `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
  - `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`
- handbook chunking proof:
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
- institutional denominator proof:
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
- retrieval projection and gate proof:
  - `tests/retrieval/evidence_attributes_suite.py`
  - `tests/evals/retrieval_chunk_quality_suite.py`

## Exit-Criteria Evidence

- Stable parent-child ids:
  - `test_single_enumerated_answer_ready_clause_keeps_clause_unit_identity`
  - `test_shared_intro_context_is_preserved_for_following_atomic_eligibility_clauses`
  - `test_shared_exclusion_intro_preserves_child_exclusion_clauses`
  - `tests/retrieval/evidence_attributes_suite.py::test_qdrant_payload_projects_answer_ready_metadata_to_internal_accessor`
- Stable condition grouping without overbroad merge:
  - `test_same_parent_multiple_rank_groups_emit_distinct_condition_group_ids`
  - `test_repeated_material_intros_under_same_parent_emit_distinct_condition_group_ids`
  - `test_repeated_time_intros_under_same_parent_emit_distinct_condition_group_ids`
  - `test_repeated_inline_example_groups_emit_distinct_group_ids`
  - `test_mixed_condition_and_procedure_clause_uses_condition_group_anchor`
- No harmful mixed intro/condition/exclusion/procedure chunk:
  - `test_student_rules_inline_example_tail_splits_from_main_exception_clause`
  - `test_student_rules_inline_multiple_example_tails_split_into_multiple_child_units`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_formal_regulation_procedure_clause_does_not_split_into_false_condition_head`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_formal_regulation_review_clause_does_not_split_into_false_condition_head`
- Table answer-readiness preserved:
  - `test_student_rules_table_chunks_get_answer_ready_fact_metadata`
  - `test_student_rules_narrative_amount_clause_can_emit_answer_ready_fact_metadata`
  - `tests/evals/retrieval_chunk_quality_suite.py::test_quality_report_flags_missing_clause_unit_id_for_clause_answer_role`
- Parent article context remains usable after retrieval projection:
  - `tests/retrieval/evidence_attributes_suite.py::test_internal_attribute_payload_uses_shared_answer_ready_field_set`
  - `tests/retrieval/evidence_attributes_suite.py::test_qdrant_payload_projects_answer_ready_metadata_to_internal_accessor`
- Institutional rules do not depend on handbook-only assumptions:
  - `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_chunks_emit_reusable_answer_ready_contract`
  - `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_procedure_list_preserves_child_steps`
  - `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_deadline_clause_emits_time_constraint`
  - `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_material_clause_emits_material_requirement`

## Verification

```bash
uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.retrieval.evidence_attributes_suite tests.evals.retrieval_chunk_quality_suite -q
```

Result: `Ran 154 tests` and `OK`.

## Residual Gaps

- Phase 3 plan coverage is now explicitly evidenced.
- Workstream-level closure still depends on Phase 11 planning/docs closeout and any remaining
  cross-phase debt tracked in `../../GAP-LEDGER.md`.
