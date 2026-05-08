---
doc_type: phase_summary
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 6 Retrieval Consumption And Fallback Removal

## Result

Phase 6 now has explicit completion-audit evidence. Retrieval ranking, evidence selection and
replan use typed v3 metadata as the primary path, while legacy fallback is observable and cannot
satisfy target regulation serving unless the runtime is explicitly in
`legacy_old_index_compatibility` mode.

This summary records audit evidence for the Phase 6 plan. The overall workstream remains active
under Phase 11 closeout.

## Evidence Surfaces

- implementation:
  - `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`
  - `packages/retrieval-core/src/campus_retrieval_core/evidence_semantics.py`
  - `packages/retrieval-core/src/campus_retrieval_core/service_execution.py`
  - `packages/retrieval-core/src/campus_retrieval_core/service_step_executor.py`
  - `packages/retrieval-core/src/campus_retrieval_core/models.py`
  - `packages/rag-agent/src/campus_rag_agent/semantic_replan.py`
  - `packages/rag-agent/src/campus_rag_agent/service_retrieval.py`
- retrieval/ranking/replan proof:
  - `tests/retrieval/evidence_attributes_suite.py`
  - `tests/retrieval/evidence_contract_ranking_suite.py`
  - `tests/retrieval/retrieval_service_replan_execution_suite.py`
- category-discovery and typed-draft consumption proof:
  - `tests/agent/rag_agent_handbook_category_discovery_suite.py`
  - `tests/agent/rag_agent_typed_answer_drafts_suite.py`

## Exit-Criteria Evidence

- Retrieval projects typed v3 metadata into internal attributes instead of relying on raw payload
  text:
  - `tests/retrieval/evidence_attributes_suite.py::test_internal_attribute_payload_uses_shared_answer_ready_field_set`
  - `tests/retrieval/evidence_attributes_suite.py::test_qdrant_payload_projects_answer_ready_metadata_to_internal_accessor`
- Ranking uses typed intent/subject/polarity/category evidence:
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_typed_metadata_ranks_positive_procedure_over_negative_exclusion_without_public_semantics`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_typed_metadata_preserves_negative_exclusion_for_negative_query`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_condition_subject_ranks_rank_threshold_clause_over_generic_eligibility`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_condition_subject_ranks_paper_publication_clause_over_generic_eligibility`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_category_discovery_ranks_category_overview_over_procedure_and_exclusion`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_institutional_deadline_query_ranks_time_constraint_over_generic_condition`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_amount_or_quota_query_ranks_table_fact_over_overview`
- Replan and post-selection self-check are typed and query-conditioned:
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_replans_low_quality_grounding_without_dropping_references`
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_replans_policy_clause_query_when_anchor_support_is_missing`
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_replans_when_top_grounding_conflicts_with_query_polarity`
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_marks_group_support_missing_for_rank_query_with_only_example_child`
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_marks_procedure_group_mismatch_when_only_condition_child_returned`
- Legacy fallback is observable and downgraded when contract metadata is incomplete:
  - `tests/retrieval/evidence_attributes_suite.py::test_fallback_diagnostics_flag_incomplete_v3_procedure_contract`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_ranking_features_report_fallback_diagnostics_when_contract_metadata_is_absent`
  - `tests/retrieval/evidence_contract_ranking_suite.py::test_incomplete_v3_sidecar_is_still_treated_as_missing_contract`
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_emits_answer_ready_fallback_diagnostics_for_legacy_index`
- Target regulation serving fails closed on legacy primary fallback, while explicit compatibility
  mode remains allowed:
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_fails_closed_when_target_regulation_path_hits_legacy_fallback`
  - `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_allows_legacy_fallback_for_explicit_compatibility_mode`
- Category discovery remains typed all the way through retrieval selection:
  - `tests/agent/rag_agent_handbook_category_discovery_suite.py::test_category_discovery_prefers_overview_source_over_exclusion_clause`
  - `tests/agent/rag_agent_handbook_category_discovery_suite.py::test_category_discovery_evidence_selection_prefers_category_overview_even_when_eligibility_scores_higher`

## Verification

```bash
uv run --all-packages python -m unittest tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.retrieval.retrieval_service_replan_execution_suite tests.agent.rag_agent_handbook_category_discovery_suite tests.agent.rag_agent_typed_answer_drafts_suite -q
```

Result: the workstream closeout session reverified the typed ranking/selection/replan path and the
legacy fallback quarantine path, including the category-discovery regression fix.

```bash
uv run --all-packages ruff check packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py packages/retrieval-core/src/campus_retrieval_core/evidence_semantics.py packages/retrieval-core/src/campus_retrieval_core/service_execution.py packages/retrieval-core/src/campus_retrieval_core/service_step_executor.py packages/retrieval-core/src/campus_retrieval_core/models.py packages/rag-agent/src/campus_rag_agent/semantic_replan.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py tests/retrieval/evidence_attributes_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/retrieval/retrieval_service_replan_execution_suite.py
```

Result: targeted touched-file lint passed in the closeout session.

## Residual Gaps

- Phase 6 planned typed-consumption and fallback-quarantine coverage is now explicitly evidenced.
- Phase 11 still owns the final planning/docs closeout and broad verification gate.
