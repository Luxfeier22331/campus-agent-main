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
  - Phase 7/8 coverage audit
  - Phase 11 planning/docs closeout

## Requirement Checklist

| Requirement Area | Expected Evidence | Current Evidence | Audit Verdict |
|------------------|-------------------|------------------|---------------|
| v3 schema and validation | shared v3 contract, role-specific required fields, validation tests | `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`, `tests/shared/test_answer_ready_evidence_contract.py`, Phase 1 summary | evidenced |
| taxonomy/registry governance | shared owner, controlled values, alias governance, release invalidation policy | `packages/shared/src/campus_shared/regulation_semantic_registry.py`, Phase 0 taxonomy admission docs, `tests/shared/test_regulation_semantic_registry.py` | partially_evidenced |
| shared semantic pattern owner | shared owner for common regulation pattern heuristics instead of ingestion-private default registry | `packages/shared/src/campus_shared/regulation_semantic_patterns.py`, `packages/ingestion-core/src/campus_ingestion_core/handbook_semantics.py`, `packages/ingestion-core/src/campus_ingestion_core/process_candidate_merging_short_textual.py`, `tests/shared/test_regulation_semantic_registry.py`, `tests/ingestion/processing_pipeline_policy_chunking_structure_suite.py`, `tests/ingestion/test_handbook_chunking_pipeline.py` | evidenced |
| parent-child chunking | stable `parent_unit_id` / `clause_unit_id` / `condition_group_id`, clause-level splits, table preservation | `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`, `tests/ingestion/test_handbook_chunking_pipeline.py`, `tests/ingestion/test_institutional_regulation_semantic_regressions.py` | partially_evidenced |
| typed extraction | oracle-backed extraction of role/subject/polarity/group/intro/procedure/category | `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`, relevant ingestion tests | partially_evidenced |
| release gate static correctness | release admission fail-close + machine-readable summaries | `packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py`, `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py`, ingestion tests | evidenced |
| retrieval typed consumption | typed ranking/selection/replan + explicit fallback diagnostics | `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`, `service_step_executor.py`, retrieval tests | evidenced |
| typed draft + grounding | typed answer slices fail-close on unsupported v3 evidence | `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`, agent tests | partially_evidenced |
| component eval attribution | fixture-backed stage attribution + release attachment | `packages/evals/src/campus_evals/answer_ready_component_eval.py`, runtime/runner suites | evidenced |
| student release proof | release/admission/component/post-publish/runtime probe + fallback zero | Phase 9 summary + artifacts, `student_rules_release_manifest_field_audit_v1.json` | evidenced |
| institutional release proof | release/admission/component/post-publish/runtime probe + fallback zero | Phase 10 summary + artifacts, `institutional_rules_release_manifest_field_audit_v1.json` | evidenced |
| legacy quarantine | explicit `target_v3_only` vs `legacy_old_index_compatibility`, docs updated | retrieval-core runtime split, Phase 11 summary, docs touched | partially_evidenced |

## Open Audit Items

1. `Phase 3/4` 需要更明确证明 clause-level / parent-child coverage 已覆盖计划中的目标，而不只是
   handbook 片段级案例。
1. `Phase 7` 需要对 `clarification` / `unsupported` / SDK path 与所有 target answer slice 的
   grounded fail-close 覆盖做更完整审计。
1. `Phase 11` 还没完成最终 broad verification 与 planning truth closeout。
