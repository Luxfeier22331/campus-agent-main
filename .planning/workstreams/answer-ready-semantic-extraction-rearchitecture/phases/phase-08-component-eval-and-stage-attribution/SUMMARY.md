---
doc_type: phase_summary
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 8 Component Eval And Stage Attribution

## Result

Phase 8 now has explicit completion-audit evidence. The workstream no longer depends only on final
answer pass/fail; deterministic component eval can attribute failures to intent, retrieval,
ranking, selection, semantic contract, draft, grounding, legacy-signal budget or release-contract
stages, and those summaries are consumable by the release lane.

This summary records audit evidence for the Phase 8 plan. The overall workstream remains active
under Phase 11 closeout.

## Evidence Surfaces

- implementation:
  - `packages/evals/src/campus_evals/answer_ready_component_eval.py`
  - `packages/evals/src/campus_evals/answer_ready_component_runtime.py`
  - `packages/evals/src/campus_evals/answer_ready_closeout_audit.py`
  - `packages/evals/src/campus_evals/regulation_answer_ready_component_live_runner.py`
  - `packages/ingestion-core/src/campus_ingestion_core/component_eval_release.py`
- deterministic eval proof:
  - `tests/evals/answer_ready_component_eval_suite.py`
  - `tests/evals/answer_ready_component_runtime_suite.py`
  - `tests/evals/answer_ready_closeout_audit_suite.py`
- realistic runtime and SDK proof:
  - `tests/agent/rag_agent_realistic_e2e_samples_suite.py`
  - `tests/evals/rag_agents_sdk_eval_suite.py`

## Exit-Criteria Evidence

- Component eval attributes primary/secondary stage failures instead of only final answer status:
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_intent_mismatch_before_downstream_failures`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_retrieval_miss_for_missing_expected_document`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_ranking_mismatch_when_answer_ready_role_is_not_top`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_selection_not_answer_ready_for_wrong_selected_role`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_semantic_contract_mismatch_for_selected_subject_and_polarity`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_draft_contract_mismatch`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_grounding_mismatch`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_primary_and_secondary_failure_classes_in_stage_order`
- Fallback budget and release-contract regressions are attributed explicitly:
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_fallback_budget_regression_for_text_cue_signal`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_fallback_budget_regression_for_legacy_public_semantic_signal`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_release_contract_missing_after_query_stages`
- Runtime observation builder preserves typed task-kind and no-answer semantics:
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_student_procedure_observation_from_runtime_response`
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_category_discovery_observation_and_preserves_release_status`
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_table_fact_observation_from_runtime_response`
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_ambiguous_scholarship_clarification_observation`
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_student_rules_no_hit_observation`
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_typed_draft_invalid_observation_with_draft_failure_reason`
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_negative_restriction_observation_from_runtime_response`
  - `tests/evals/answer_ready_component_runtime_suite.py::test_builds_institutional_unsupported_observation_when_title_only_candidates_fail_closed`
- Realistic denominator cases are covered across student and institutional scopes:
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_passes_for_student_card_reissue_procedure_case`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_passes_for_ambiguous_scholarship_clarification_case`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_passes_for_student_scholarship_amount_table_fact_case`
  - `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_passes_for_student_rules_no_hit_case`
  - `tests/evals/answer_ready_closeout_audit_suite.py`
  - `tests/agent/rag_agent_realistic_e2e_samples_suite.py`
- Release-lane integration and SDK path share the same deterministic eval expectations:
  - `packages/ingestion-core/src/campus_ingestion_core/component_eval_release.py`
  - `tests/evals/rag_agents_sdk_eval_suite.py`

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite tests.evals.answer_ready_component_runtime_suite tests.agent.rag_agent_realistic_e2e_samples_suite tests.evals.rag_agents_sdk_eval_suite -q
```

Result: `Ran 49 tests` and `OK` in the closeout session.

```bash
uv run --all-packages ruff check packages/evals/src/campus_evals/answer_ready_component_eval.py packages/evals/src/campus_evals/answer_ready_component_runtime.py packages/evals/src/campus_evals/answer_ready_closeout_audit.py packages/ingestion-core/src/campus_ingestion_core/component_eval_release.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py tests/evals/answer_ready_component_runtime_suite.py tests/evals/rag_agents_sdk_eval_suite.py
```

Result: targeted touched-file lint passed in the closeout session.

## Residual Gaps

- Phase 8 planned stage-attribution coverage is now explicitly evidenced.
- Workstream closure still depends on Phase 11 broad verification and final planning-truth closeout.
