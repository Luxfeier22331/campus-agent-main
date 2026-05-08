---
doc_type: completion_audit
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Completion Audit

## Purpose

本文件把 `answer-ready-semantic-extraction-rearchitecture` 的完成判断从“代码大致做了很多”
收口为逐项审计。只有当 requirement、phase deliverable、release proof、docs 和测试覆盖都能
映射到真实证据时，workstream 才能关闭。

## Audit Status

- overall: `in_progress`
- current focus:
  - Phase 11 planning/docs closeout
  - fresh broad verification has completed; remaining failures are repo-wide baseline issues outside
    this workstream

## Requirement Checklist

| Requirement Area | Expected Evidence | Current Evidence | Audit Verdict |
| ---------------- | ----------------- | ---------------- | ------------- |
| v3 schema and validation | shared v3 contract, role-specific required fields, validation tests | `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`, `tests/shared/test_answer_ready_evidence_contract.py`, Phase 1 summary | evidenced |
| taxonomy/registry governance | shared owner, controlled values, alias governance, release invalidation policy | `packages/shared/src/campus_shared/regulation_semantic_registry.py`, `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`, Phase 0 taxonomy admission docs, `tests/shared/test_regulation_semantic_registry.py`, `tests/shared/test_answer_ready_evidence_contract.py`, Phase 2 summary | evidenced |
| shared semantic pattern owner | shared owner for common regulation pattern heuristics instead of ingestion-private default registry | `packages/shared/src/campus_shared/regulation_semantic_patterns.py`, `packages/ingestion-core/src/campus_ingestion_core/handbook_semantics.py`, `packages/ingestion-core/src/campus_ingestion_core/process_candidate_merging_short_textual.py`, `tests/shared/test_regulation_semantic_registry.py`, `tests/ingestion/processing_pipeline_policy_chunking_structure_suite.py`, `tests/ingestion/test_handbook_chunking_pipeline.py` | evidenced |
| parent-child chunking | stable `parent_unit_id` / `clause_unit_id` / `condition_group_id`, clause-level splits, table preservation | `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`, `tests/ingestion/test_handbook_chunking_pipeline.py`, `tests/ingestion/test_institutional_regulation_semantic_regressions.py`, `tests/retrieval/evidence_attributes_suite.py`, Phase 3 summary | evidenced |
| typed extraction | oracle-backed extraction of role/subject/polarity/group/intro/procedure/category | `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`, `tests/ingestion/test_handbook_chunking_pipeline.py`, `tests/ingestion/test_institutional_regulation_semantic_regressions.py`, `tests/evals/answer_ready_component_runtime_suite.py`, Phase 4 summary | evidenced |
| release gate static correctness | release admission fail-close + machine-readable summaries | `packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py`, `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py`, ingestion tests | evidenced |
| retrieval typed consumption | typed ranking/selection/replan + explicit fallback diagnostics | `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`, `service_step_executor.py`, retrieval tests | evidenced |
| typed draft + grounding | typed answer slices fail-close on unsupported v3 evidence | `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`, `packages/rag-agent/src/campus_rag_agent/rag_sdk_output.py`, agent/eval suites, Phase 7 summary | evidenced |
| component eval attribution | fixture-backed stage attribution + release attachment | `packages/evals/src/campus_evals/answer_ready_component_eval.py`, runtime/runner suites | evidenced |
| student release proof | release/admission/component/post-publish/runtime probe + fallback zero | Phase 9 summary + artifacts, `student_rules_release_manifest_field_audit_v1.json` | evidenced |
| institutional release proof | release/admission/component/post-publish/runtime probe + fallback zero | Phase 10 summary + artifacts, `institutional_rules_release_manifest_field_audit_v1.json`, `institutional_rules_re_audit_report_v1.json` | evidenced |
| legacy quarantine | explicit `target_v3_only` vs `legacy_old_index_compatibility`, docs updated | retrieval-core runtime split, `packages/retrieval-core/src/campus_retrieval_core/models.py`, `packages/retrieval-core/src/campus_retrieval_core/service_step_executor.py`, Phase 11 summary, `docs/architecture/system/retrieval-serving-architecture.md`, `docs/architecture/system/data-plane-architecture.md`, `docs/policies/student-handbook-chunking-and-validation-policy.md` | evidenced |

## Open Audit Items

1. fresh broad verification 已完成，不再存在已知的 workstream-owned broad failure：
   - broad command:
     `uv run --all-packages python -m unittest discover -s tests -t .`
   - latest result: `Ran 2895 tests in 25.326s`, `FAILED (failures=7, errors=1, skipped=1)`
   - 与本 workstream 直接相关、且在 closeout 审计中发现的 broad regression 已清零：
     - `tests.ingestion.test_official_web_regulation_materialization.OfficialWebRegulationMaterializationTest.test_materialization_preserves_regulation_preface_and_drops_inline_link_child_duplicate`
       之前因 canonical body 泄漏 pre-body wrapper heading `干部人事` 失败；现已修复并通过
     - 修复方式：`official_web_regulation_structure.py` 的
       `regulation_body_text_for_materialization(...)` 不再只依赖窄 wrapper 词表，而是复用
       pre-body heading 判定，在保留 typed candidate `regulation_lines` 审计信息的同时，从最终
       canonical body 中稳定剥离 wrapper heading
   - 相关验证证据：
     - `uv run --all-packages python -m unittest tests.ingestion.test_official_web_regulation_materialization.OfficialWebRegulationMaterializationTest.test_materialization_preserves_regulation_preface_and_drops_inline_link_child_duplicate -v`
       通过
     - `uv run --all-packages python -m unittest tests.ingestion.test_official_web_regulation_quality_audit tests.ingestion.official_web_projection_source_pack_regulation_suite tests.ingestion.test_official_web_regulation_materialization -q`
       共 `24` 个相关测试通过（`skipped=1`）
1. latest broad verification 中剩余失败均归类为 repo baseline / 外部依赖 / 其他 workstream 问题，
   不是本 workstream 当前 diff 造成：
   - `tests.api.supervisor_api_bridge_services_suite.*` 2 个失败：supervisor bridge /
     campus-services wiring
   - `tests.ingestion.authenticated_notice_import_inventory_suite.*` 1 个 error：
     `example.test` PostgreSQL 解析/连接超时
   - `tests.ingestion.test_collected_notice_queue_consumer.*` 1 个失败：队列 retryable 状态约定
   - `tests.ingestion.test_official_web_university_collection_worker.*` 1 个失败：repo 当前
     `configs/sources/official_web/muc_public/scheduler-policy.json` 不存在
     `university-core-baseline` lane，属于配置/测试失配，不是 answer-ready 语义抽取回归
   - `tests.test_check_decomposition_tracked.*` 1 个失败：repo decomposition baseline 漂移
   - `tests.test_environment_layout.*` 1 个失败：active env example 清单新增
     `official-web-release-task.env.example`
   - `tests.test_supervisor_runtime_process_smoke.*` 1 个失败：mock runtime smoke 期望与当前
     `PROMPT_RUNTIME_PROVIDER=openai-responses` 不一致
1. 当前 `pnpm docs:lint` 的 repo-wide 阻塞是无关文件
   `infra/otel/README.md:27` 的 `MD013/line-length`，不是本 workstream 新引入的问题；在该
   无关基线问题清除前，不能把仓库级 markdown gate 记为已通过。
1. completion audit 中曾发现的 in-scope ingestion regressions 已完成修复并验证，不再阻塞：
   - short-text merge 不再因为语义推导出的 `eligibility_condition` 被过早视为 merge-atomic，
     `ProcessingPipelinePolicyChunkingMergeTest.test_build_indexable_chunks_absorbs_trailing_short_tail_into_previous_textual_chunk`
     已恢复通过
   - explicit `regulation_body` metadata 不会在细粒度 body-role 推导为空时被空语义覆盖，
     internal-notice institutional chunk prep 的 `section_path` / `html` 污染质量门禁已恢复通过
   - 验证证据：
     `uv run --all-packages python -m unittest ...` 窄范围 6 个关键用例全部通过；
     `uv run --all-packages python -m unittest tests.ingestion.processing_pipeline_policy_chunking_merge_suite tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep tests.ingestion.test_internal_notice_regulation_candidate_chunk_prep tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions -q`
     共 `101` 个相邻 ingestion 测试全部通过
1. completion audit 还补上了一个真实的 static-gate 结构收口，不再只停留在“shared resolver 里还有
   fallback 分支”的代码阅读结论：
   - target v3 `procedure_step` metadata 现在会在 shared validation 和 release chunk quality
     两层同时拒绝 generic placeholder actor `responsible_party`
   - target v3 `procedure_step` metadata 现在也会拒绝 generic placeholder action
     `procedure_step`
   - 相关验证证据：
     - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_procedure_actor_uses_generic_fallback_actor tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_procedure_action_uses_generic_fallback_action tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_generic_fallback_procedure_actor tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_generic_fallback_procedure_action -q`
       通过
     - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
       共 `95` 个测试通过
1. post-publish payload 语义审计缺口已补齐，不再只依赖 component-eval 汇总计数来代表“已发布 target-v3
   payload 没有 unresolved fallback debt”：
   - `audit_published_scope_release(...)` 现在会对 sampled published payload 复跑
     target-v3 answer-ready contract 审计
   - 同时会显式拒绝 sampled target-v3 payload 上的 fallback provenance 泄漏：
     - `condition_subject_provenance=fallback:*`
     - `procedure_action_provenance=fallback:*`
   - 这样 closeout 审计现在可以直接证明“发布后索引中的 target-v3 payload”不会把 unresolved
     fallback provenance 当成已发布真相，而不只是证明 release chunk quality 或 component eval
     在发布前/离线样本上通过
   - 相关验证证据：
     - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_sampled_payload_keeps_target_v3_fallback_provenance tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_fails_when_sampled_payload_keeps_target_v3_fallback_procedure_provenance -q`
       通过
     - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release tests.ingestion.test_index_release_acceptance -q`
       共 `61` 个测试通过
     - `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py`
       通过
     - `uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py --check`
       通过
1. post-publish audit summary 现在也满足了 Phase 0 release-adoption proof 对 sampled payload
   contract evidence 的显式字段要求，不再只记录 `sampled_payload_count`：
   - audit summary 现在会输出 `sampled_payload_contract_versions`
   - 该字段逐条记录 sampled point payload 的 `evidence_contract_version`；无该字段时显式记
     为 `<missing>`
   - 这样 Phase 9/10 的 post-publish audit 终于可以直接回答“sampled published payload 的
     contract version 是什么”，而不是只用 chunk-quality/admission 间接代理
   - 相关验证证据：
     - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_reports_sampled_payload_contract_versions -q`
       通过
     - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release tests.ingestion.test_re_audit_regulation_rag_release_worker -q`
       共 `17` 个测试通过
     - `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py tests/ingestion/test_registry_scope_release.py tests/ingestion/test_re_audit_regulation_rag_release_worker.py`
       通过

## Phase 2 Audit Matrix

| Planned Target | Evidence |
| -------------- | -------- |
| shared taxonomy/registry owner replaces ingestion-private subject/category/procedure truth | `phase-02-taxonomy-and-registry-normalization/SUMMARY.md`, `packages/shared/src/campus_shared/regulation_semantic_registry.py`, `tests/shared/test_regulation_semantic_registry.py::test_shared_taxonomy_definitions_carry_governance_metadata` |
| generalized category registry is not scholarship-only | `tests/shared/test_regulation_semantic_registry.py::test_shared_student_rules_registry_covers_non_scholarship_categories`, `tests/shared/test_answer_ready_evidence_contract.py::test_category_overview_requires_generalized_member_registry_fields` |
| condition-subject aliases and structured metadata canonicalize through shared owner | `tests/shared/test_regulation_semantic_registry.py::test_shared_condition_subject_canonicalization_handles_legacy_aliases`, `tests/shared/test_regulation_semantic_registry.py::test_shared_condition_subject_resolution_prefers_structured_group_subject`, `tests/shared/test_regulation_semantic_registry.py::test_shared_condition_subject_resolution_prefers_structured_intro_subject` |
| procedure action/actor taxonomy is controlled and reusable | `tests/shared/test_regulation_semantic_registry.py::test_shared_procedure_action_resolution_prefers_explicit_metadata`, `tests/shared/test_regulation_semantic_registry.py::test_shared_procedure_actor_resolution_supports_institutional_office_clause`, `tests/shared/test_answer_ready_evidence_contract.py::test_v3_validation_fails_when_procedure_actor_is_unknown` |
| category discovery consumes shared registry-backed category truth | `tests/agent/rag_agent_handbook_category_discovery_suite.py::test_category_discovery_enters_retrieval_with_category_policy_set`, `tests/agent/rag_agent_handbook_category_discovery_suite.py::test_category_discovery_prefers_overview_source_over_exclusion_clause`, `tests/agent/rag_agent_typed_answer_drafts_suite.py::test_category_discovery_policy_list_can_be_completed_from_registry_backed_member_document` |

## Phase 3 Audit Matrix

| Planned Target | Evidence |
| -------------- | -------- |
| stable parent/child ids | `phase-03-clause-parent-child-unit-model/SUMMARY.md`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_single_enumerated_answer_ready_clause_keeps_clause_unit_identity`, `tests/retrieval/evidence_attributes_suite.py::test_qdrant_payload_projects_answer_ready_metadata_to_internal_accessor` |
| stable condition groups under repeated intros and repeated examples | `tests/ingestion/test_handbook_chunking_pipeline.py::test_same_parent_multiple_rank_groups_emit_distinct_condition_group_ids`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_repeated_material_intros_under_same_parent_emit_distinct_condition_group_ids`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_repeated_time_intros_under_same_parent_emit_distinct_condition_group_ids`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_repeated_inline_example_groups_emit_distinct_group_ids` |
| no harmful mixed intro/condition/exclusion/procedure chunk | `tests/ingestion/test_handbook_chunking_pipeline.py::test_student_rules_inline_example_tail_splits_from_main_exception_clause`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_mixed_condition_and_procedure_clause_uses_condition_group_anchor`, `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_formal_regulation_procedure_clause_does_not_split_into_false_condition_head`, `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_formal_regulation_review_clause_does_not_split_into_false_condition_head` |
| table answer readiness preserved | `tests/ingestion/test_handbook_chunking_pipeline.py::test_student_rules_table_chunks_get_answer_ready_fact_metadata`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_student_rules_narrative_amount_clause_can_emit_answer_ready_fact_metadata`, `tests/evals/retrieval_chunk_quality_suite.py` |
| institutional parent-child coverage uses same unit model | `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_chunks_emit_reusable_answer_ready_contract`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_procedure_list_preserves_child_steps`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_deadline_clause_emits_time_constraint`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_institutional_rules_material_clause_emits_material_requirement` |

## Phase 4 Audit Matrix

| Planned Target | Evidence |
| -------------- | -------- |
| v3 metadata emitted with version/provenance | `phase-04-typed-semantic-extraction-pipeline/SUMMARY.md`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_answer_ready_chunk_metadata_emits_contract_validation_result`, `tests/shared/test_answer_ready_evidence_contract.py` |
| typed contracts emitted for condition/exclusion/exception/material/procedure/category/table | `tests/ingestion/test_handbook_chunking_pipeline.py::test_student_rules_procedure_intro_has_complete_intro_contract`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_material_list_children_emit_material_requirement_answer_role`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_time_list_children_emit_time_constraint_answer_role`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_student_rules_table_chunks_get_answer_ready_fact_metadata`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_student_rules_document_can_emit_multiple_category_overviews` |
| institutional oracle-backed extraction freeze | `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_oracle_institutional_material_and_deadline_slices_freeze_group_contracts`, `tests/ingestion/test_institutional_regulation_semantic_regressions.py::test_oracle_institutional_category_discovery_slice_freezes_registry_backed_overview` |
| prepared chunks carry group/intro/procedure/category contracts | `tests/ingestion/test_handbook_chunking_pipeline.py::test_material_requirement_condition_group_id_is_emitted_for_answer_ready_contract`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_table_fact_condition_group_id_uses_shared_subject_resolution`, `tests/ingestion/test_handbook_chunking_pipeline.py::test_student_rules_category_members_get_registry_overview_chunks` |
| frozen target samples map to correct typed behavior or named fail-close | `tests/evals/answer_ready_closeout_audit_suite.py`, `tests/evals/answer_ready_component_runtime_suite.py` |

## Phase 5 Audit Matrix

| Planned Target | Evidence |
| -------------- | -------- |
| release admission fail-closes on static v3 contract and semantic conflicts | `phase-05-answer-ready-quality-gates/SUMMARY.md`, `tests/ingestion/test_index_release_acceptance.py::test_release_chunk_quality_reports_static_polarity_role_conflicts`, `tests/ingestion/test_index_release_acceptance.py::test_release_chunk_quality_reports_condition_subject_role_conflicts`, `tests/ingestion/test_index_release_acceptance.py::test_release_chunk_quality_reports_procedure_action_role_conflicts` |
| grouped and category-overview contract violations are caught before publish | `tests/ingestion/test_index_release_acceptance.py::test_release_chunk_quality_reports_intro_condition_group_id_conflicts`, `tests/ingestion/test_index_release_acceptance.py::test_release_chunk_quality_reports_condition_group_parent_conflicts`, `tests/ingestion/test_index_release_acceptance.py::test_release_chunk_quality_reports_category_overview_missing_typed_subject_contract`, `tests/ingestion/test_index_release_acceptance.py::test_release_chunk_quality_reports_category_overview_missing_group_contract` |
| machine-readable Phase 5 manifest fields are carried through release admission | `tests/ingestion/test_index_release_acceptance.py::test_release_admission_manifest_carries_phase5_answer_ready_quality_fields`, `tests/ingestion/test_index_release_acceptance.py::test_release_admission_manifest_requires_answer_ready_contract_passed` |
| alias publish blocks on chunk-quality and contract failures | `tests/ingestion/test_registry_scope_release_acceptance_wiring.py::test_publish_scope_release_blocks_query_serving_alias_when_chunk_quality_fails`, `tests/ingestion/test_registry_scope_release_acceptance_wiring.py::test_publish_scope_release_blocks_student_rules_when_answer_ready_contract_missing` |

## Phase 6 Audit Matrix

| Planned Target | Evidence |
| -------------- | -------- |
| typed metadata is the primary retrieval projection and ranking signal | `phase-06-retrieval-consumption-and-fallback-removal/SUMMARY.md`, `tests/retrieval/evidence_attributes_suite.py::test_internal_attribute_payload_uses_shared_answer_ready_field_set`, `tests/retrieval/evidence_contract_ranking_suite.py::test_typed_metadata_ranks_positive_procedure_over_negative_exclusion_without_public_semantics` |
| query-conditioned ranking prefers subject/category/table-specific evidence over generic hits | `tests/retrieval/evidence_contract_ranking_suite.py::test_condition_subject_ranks_rank_threshold_clause_over_generic_eligibility`, `tests/retrieval/evidence_contract_ranking_suite.py::test_category_discovery_ranks_category_overview_over_procedure_and_exclusion`, `tests/retrieval/evidence_contract_ranking_suite.py::test_amount_or_quota_query_ranks_table_fact_over_overview` |
| typed self-check and replan surface subject/polarity/group failures | `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_replans_when_top_grounding_conflicts_with_query_polarity`, `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_marks_group_support_missing_for_rank_query_with_only_example_child`, `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_marks_procedure_group_mismatch_when_only_condition_child_returned` |
| target regulation serving fails closed on legacy primary fallback | `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_fails_closed_when_target_regulation_path_hits_legacy_fallback`, `tests/retrieval/retrieval_service_replan_execution_suite.py::test_execute_retrieval_plan_allows_legacy_fallback_for_explicit_compatibility_mode` |

## Phase 7 Audit Matrix

| Planned Target | Evidence |
| -------------- | -------- |
| typed drafts cannot complete without v3 support | `phase-07-typed-answer-grounding-integration/SUMMARY.md`, `tests/agent/rag_agent_typed_answer_drafts_suite.py`, `tests/agent/rag_agent_answer_grounding_suite.py::test_target_v3_rejects_legacy_like_procedure_fixture_before_synthesis` |
| category/procedure/judgment/condition-table claims stay grounded | `tests/agent/rag_agent_typed_answer_drafts_suite.py`, `tests/agent/rag_agent_answer_grounding_suite.py`, `tests/agent/rag_agent_realistic_e2e_samples_suite.py` |
| clarification / unsupported remain explicit and non-fabricated | `tests/agent/rag_agent_realistic_e2e_samples_suite.py::test_fuzzy_scholarship_procedure_clarifies_before_retrieval`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_passes_for_ambiguous_scholarship_clarification_case`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_passes_for_student_rules_no_hit_case`, `tests/evals/answer_ready_component_runtime_suite.py` |
| mismatch attribution is stage-aware | `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_draft_contract_mismatch`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_grounding_mismatch`, `tests/evals/answer_ready_component_runtime_suite.py::test_builds_typed_draft_invalid_observation_with_draft_failure_reason` |
| SDK path is validated against same grounding requirements | `tests/agent/rag_agent_sdk_contract_suite.py`, `tests/agent/rag_agent_sdk_service_suite.py`, `tests/evals/rag_agents_sdk_eval_suite.py` |

## Phase 8 Audit Matrix

| Planned Target | Evidence |
| -------------- | -------- |
| failures are attributed to intent/retrieval/ranking/selection/semantic-contract/draft/grounding/release stages | `phase-08-component-eval-and-stage-attribution/SUMMARY.md`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_intent_mismatch_before_downstream_failures`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_ranking_mismatch_when_answer_ready_role_is_not_top`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_draft_contract_mismatch`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_grounding_mismatch` |
| fallback-budget and release-contract regressions are explicit eval failures | `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_fallback_budget_regression_for_text_cue_signal`, `tests/evals/answer_ready_component_eval_suite.py::test_component_eval_reports_release_contract_missing_after_query_stages` |
| runtime observations preserve typed task-kind and no-answer semantics | `tests/evals/answer_ready_component_runtime_suite.py::test_builds_category_discovery_observation_and_preserves_release_status`, `tests/evals/answer_ready_component_runtime_suite.py::test_builds_ambiguous_scholarship_clarification_observation`, `tests/evals/answer_ready_component_runtime_suite.py::test_builds_student_rules_no_hit_observation`, `tests/evals/answer_ready_component_runtime_suite.py::test_builds_typed_draft_invalid_observation_with_draft_failure_reason` |
| denominator covers realistic student/institutional rows and SDK path | `tests/evals/answer_ready_closeout_audit_suite.py`, `tests/agent/rag_agent_realistic_e2e_samples_suite.py`, `tests/evals/rag_agents_sdk_eval_suite.py` |
