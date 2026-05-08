---
doc_type: phase_summary
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 4 Typed Semantic Extraction Pipeline

## Result

Phase 4 now has explicit audit proof that ingestion produces the planned v3 typed metadata from
structured regulation units and registry/taxonomy owners, and that the frozen student/institutional
oracle rows are represented either by correct typed evidence behavior or by named fail-close
behavior in downstream runtime/component observation.

This summary records audit evidence for the Phase 4 plan. The overall workstream remains active
under Phase 11 closeout.

## Evidence Surfaces

- implementation:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/regulation_semantic_patterns.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
  - `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py`
- ingestion extraction proof:
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
- validation / gate proof:
  - `tests/shared/test_answer_ready_evidence_contract.py`
  - `tests/evals/retrieval_chunk_quality_suite.py`
- oracle/runtime attribution proof:
  - `tests/evals/answer_ready_component_runtime_suite.py`
  - `tests/evals/answer_ready_closeout_audit_suite.py`

## Exit-Criteria Evidence

- Required v3 metadata is produced at ingestion time with version/provenance:
  - `test_answer_ready_chunk_metadata_emits_contract_validation_result`
  - `test_explicit_condition_subject_alias_is_canonicalized_in_v3_contract`
  - `test_definition_and_table_fact_default_to_neutral_condition_polarity`
  - `tests/shared/test_answer_ready_evidence_contract.py`
- Condition/exclusion/exception/material/procedure/category/table contracts are emitted:
  - `test_shared_exclusion_intro_preserves_child_exclusion_clauses`
  - `test_student_rules_procedure_intro_has_complete_intro_contract`
  - `test_material_list_children_emit_material_requirement_answer_role`
  - `test_time_list_children_emit_time_constraint_answer_role`
  - `test_student_rules_table_chunks_get_answer_ready_fact_metadata`
  - `test_student_rules_document_can_emit_multiple_category_overviews`
- Institutional denominator uses the same typed contract:
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_material_list_intro_with_submit_followed_by_children_emits_typed_material_contract`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_time_list_intro_with_below_deadlines_emits_typed_time_contract`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_oracle_institutional_material_and_deadline_slices_freeze_group_contracts`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_oracle_institutional_category_discovery_slice_freezes_registry_backed_overview`
- Condition-group, intro, procedure and category contracts are present in prepared chunks:
  - `test_material_requirement_condition_group_id_is_emitted_for_answer_ready_contract`
  - `test_table_fact_condition_group_id_uses_shared_subject_resolution`
  - `test_student_rules_procedure_intro_segment_uses_procedure_role`
  - `test_student_rules_category_members_get_registry_overview_chunks`
- Frozen target samples map to explicit typed behavior or named fail-close paths:
  - `tests/evals/answer_ready_closeout_audit_suite.py` covers:
    - `处分怎么消`
    - `哪些情况不能解除处分`
    - `成绩没前十还能评国奖吗`
    - `论文能不能算国奖条件`
    - `本科生有哪些奖学金能申请`
    - `学生证丢了怎么补`
  - `tests/evals/answer_ready_component_runtime_suite.py` covers:
    - `奖学金怎么申请`
    - `校内宇宙签证办理处`
    - `申诉有时间限制吗`
    - `申请复核要交什么材料`

## Verification

```bash
uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.retrieval.evidence_attributes_suite tests.evals.retrieval_chunk_quality_suite -q
```

Result: `Ran 154 tests` and `OK`.

## Residual Gaps

- Phase 4 planned semantic-extraction coverage is now explicitly evidenced.
- Broader workstream closure still depends on remaining cross-phase debt and Phase 11 planning/docs
  truth closeout.
