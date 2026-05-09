---
doc_type: gap_ledger
status: active
created: 2026-05-07
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Answer-Ready Semantic Extraction Rearchitecture

This ledger tracks planned and closed debt for the active workstream. All known workstream-owned
debt is now evidenced as closed, but the workstream intentionally remains open until it is
explicitly marked complete. Each phase update records the evidence links, status and command
outputs that support the eventual closeout claim.

## Debt Ledger

| Gap | Target Resolution | Owner Phase | Status |
| --- | ----------------- | ----------- | ------ |
| semantic correctness has no frozen oracle | Phase 0 gold matrix maps sample -> intent / answer role / subject / polarity / group / draft / grounding expectation | Phase 0, Phase 8 | phase0_closed |
| release adoption proof can stay abstract | Phase 0 binds concrete release/admission/alias commands and required artifact fields for Phase 9/10 | Phase 0, Phase 9, Phase 10 | phase0_closed |
| taxonomy values can grow without governance | admission rules, alias review, unknown handling and release invalidation policy | Phase 0, Phase 2 | phase0_closed |
| static release gates and query-conditioned checks are mixed | static metadata validation remains release admission; query-conditioned contradictions move to retrieval/component eval | Phase 0, Phase 5, Phase 6, Phase 8 | phase0_closed |
| `condition_subject` extraction still has heuristic lineage | shared taxonomy owner is now established in `packages/shared`; shared resolver now canonicalizes explicit aliases, resolves shared `action_type` ownership, emits typed list/group-intro assignments plus short heading-role hints, chunking / answer-role detection now consume shared intro/list/heading owners instead of maintaining duplicate material/time/group/category cue lists, and common regulation-body `content_role` classification has now also moved to shared `regulation_semantic_patterns.py` with direct shared regression coverage plus merge-time protection for standalone negative clauses; Phase 4 still needs structured-unit driven production that removes the remaining heuristic lineage beyond the now-closed ingestion-private body-role owner | Phase 2, Phase 4 | phase2_owner_normalized_phase4_shared_assignment_intro_heading_and_body_role_owner_closed |
| `condition_group_id` lacks stable production chain | Phase 3/4 audit evidence now covers stable repeated intro/example groups, clause-level child identity, direct chunk-time `condition_group_id` / `introduced_condition_group_id` materialization, bridge-key leak fail-close and parent/subject conflict validation across student and institutional denominators; completion audit now treats stable grouped identity as evidenced instead of partial | Phase 3, Phase 4 | phase3_phase4_audit_closed |
| typed eligibility intro is not a grouping contract | Phase 1 froze the intro contract, and Phase 4 now produces typed `eligibility_group` / `procedure_list` / `material_list` / `time_list` intro metadata with explicit non-answer-bearing status, typed subject/group identity and fail-closed scope/subject/group conflict validation in both student and institutional denominator tests | Phase 1, Phase 4 | phase1_phase4_audit_closed |
| procedure step semantics still mix cue parsing and typed fields | Shared procedure action/actor ownership is now centralized in `packages/shared`; ingestion emits typed step metadata, release validation fail closes on unknown procedure actors/next actors, and closeout hardening now also rejects generic placeholder actor `responsible_party` and generic placeholder action `procedure_step` for target v3 chunks, so unresolved procedure semantics can no longer pass static admission as valid target metadata | Phase 2, Phase 4, Phase 5 | phase2_phase4_owner_evidenced_phase5_generic_placeholder_gate_closed |
| category overview is not generalized across regulation categories | Shared category registry now owns generalized regulation categories beyond scholarship-only paths, and Phase 2/4 audit evidence covers reusable category-overview contract production together with registry-backed student and institutional category-discovery behavior | Phase 2, Phase 4 | phase2_phase4_audit_closed |
| chunk quality gate checks defects more than semantic correctness | Phase 5 static gate now enforces role-specific v3 fields, query-independent semantic contradictions, grouped/category-overview contract correctness, and generic procedure placeholder rejection before publish; completion audit now treats static semantic admission as evidenced instead of partial | Phase 5 | phase5_audit_closed |
| retrieval can still use text cues as primary signal | fallback budget zero for target v3 releases; old-index-only quarantine. Component eval now fails target rows for legacy primary fallback signals `text_cue`, `public_semantic` and `public_content_role`, target query-enabled regulation release now fail-closes on missing component-eval proof or `pending_phase8/not_applicable` manifest states, query-serving runtime release guard requires `release_admission_status=passed` plus `component_eval_status=passed`, runtime retrieval now explicitly splits `target_v3_only` vs `legacy_old_index_compatibility` so target regulation serving paths fail closed when legacy fallback would become the primary path, post-selection grounding now uses typed group metadata to surface `group_support_missing` / answer-role mismatch failures before any generic fallback path, retrieval fallback diagnostics now evaluate role-specific v3 contract completeness instead of only base-field presence so incomplete sidecars downgrade to `missing_contract`, and target-v3 quarantine now skips non-answer-bearing weak hits so title/navigation misses return to normal `no_answer` handling instead of becoming retrieval hard errors | Phase 6, Phase 11 | phase6_runtime_guard_phase6_group_aware_self_check_and_phase11_runtime_quarantine_implemented |
| typed answer support can drift from evidence contract | typed answer drafts now fail closed on missing v3 typed fields for policy-list / procedure / judgment / condition-table slices, `typed_answer_draft_invalid` is now a reachable runtime fail-close reason instead of a dead branch, deterministic claim supports preserve typed row semantics for `table_fact` / `time_constraint` / `material_requirement`, clarification / unsupported remain explicit non-grounded outcomes, and the admitted SDK path is validated against the same source/span support requirements; Phase 7 audit evidence now covers every frozen answer slice family plus clarification, unsupported and SDK fail-close behavior | Phase 7 | phase7_audit_closed |
| final E2E hides component failure stage | component eval now has fixture-backed case loading, deterministic primary/secondary stage attribution, gate classification, missing-observation handling, student/institutional denominator coverage, runtime observation harvesting from real `AgentResponse` + retrieval fallback signals, release-lane attachment into release artifacts / Qdrant payload metadata / regulation release-admission evidence, explicit clarification observation semantics for the frozen `student_scholarship_apply_ambiguous` oracle row, explicit regulation-family unsupported/no-hit observation semantics for both mandatory scopes, explicit `typed_answer_draft_invalid` attribution to `draft_contract_mismatch` instead of generic no-hit or derivative grounding failure, semantic task-kind attribution for document-locked student procedure/judgment rows, and additional oracle-backed denominator rows for student rank-threshold judgment, paper/publication judgment, student-card reissue, student exclusion, institutional procedure/category discovery, and regulation-family scholarship `table_fact` amount/quota lookup; Phase 8 audit evidence is now explicitly summarized and linked | Phase 8 | phase8_audit_closed |
| `student_rules` lacks v3 rebuilt release evidence | rebuild through regulation RAG release lane with acceptance and alias evidence; Phase 9 is now closed with release `r20260507_154528_764347_1005cea7`, serving alias adoption, fresh runtime probe and formal re-audit evidence proving `fallback_primary_signal_count=0`, `semantic_oracle_pass_count=9`, `semantic_oracle_fail_count=0` | Phase 9 | phase9_closed |
| `institutional_rules` lacks v3 rebuilt release evidence | rebuild through regulation RAG release lane with acceptance and alias evidence; Phase 10 is now closed with fresh prep/admission/release/probe artifacts, published alias adoption, release metadata guard pass and repo-governed preview GC evidence for remote Qdrant WAL recovery | Phase 4, Phase 10 | phase10_closed |
| legacy compatibility can leak into target completion | legacy old-index lane is isolated, observable and excluded from completion; runtime contract requires explicit compatibility mode for old-index fallback; post-publish audit now revalidates both flat sampled payload metadata and runtime-effective `_node_content` metadata and fails on target-v3 projection drift, and planning/docs truth now records target regulation serving as `target_v3_only` | Phase 11 | phase11_closed |

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

Phase 2/4 owner-migration evidence update:

- shared `action_type` owner and chunking/group-subject owner migration:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `packages/ingestion-core/src/campus_ingestion_core/handbook_semantics.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
- verification:
  - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline -q`
  - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_regulation_semantic_regressions tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_handbook_chunking_pipeline -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/__init__.py packages/ingestion-core/src/campus_ingestion_core/handbook_semantics.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/shared/test_regulation_semantic_regressions.py tests/ingestion/test_institutional_regulation_semantic_regressions.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/__init__.py packages/ingestion-core/src/campus_ingestion_core/handbook_semantics.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/shared/test_regulation_semantic_regressions.py tests/ingestion/test_institutional_regulation_semantic_regressions.py --check`
- shared intro/list + group-intro owner migration:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_list_role_hint_resolves_material_list_variants tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_list_role_hint_resolves_time_list_variants tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_list_role_hint_distinguishes_procedure_list -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_group_intro_kind_resolves_condition_intro_variants tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_group_intro_kind_resolves_exclusion_intro_variants tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_group_intro_kind_reuses_typed_list_intros -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_student_rules_uses_regulation_aware_answer_ready_segments -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py tests/shared/test_regulation_semantic_registry.py --check`
- shared answer-role owner migration:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.shared.test_answer_ready_evidence_contract -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py tests/shared/test_regulation_semantic_registry.py --check`
- shared heading/category owner migration:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_heading_role_hint_resolves_procedure_category_headings tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_heading_role_hint_resolves_material_and_time_category_headings tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_heading_role_hint_resolves_generic_category_heading -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_material_list_children_emit_material_requirement_answer_role tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_student_rules_procedure_intro_has_complete_intro_contract tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_student_rules_procedure_steps_are_not_misclassified_as_eligibility tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_student_rules_ordinary_but_clause_is_not_exception_rule tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_material_list_intro_with_submit_followed_by_children_emits_typed_material_contract -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py tests/shared/test_regulation_semantic_registry.py --check`
- shared procedure actor / next-actor rule-table owner cleanup:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_actor_resolution_prefers_student_affairs_office_over_student tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_actor_resolution_prefers_academic_affairs_office_over_student -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py --check`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_actor_resolution_prefers_college_over_student_object tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_actor_resolution_prefers_instructor_over_student_object -q`
- shared procedure action rule-table owner cleanup:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_action_resolution_prefers_college_review_over_student_object_submit tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_action_resolution_prefers_office_review_over_student_object_submit -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_action_resolution_does_not_treat_handling_decision_as_process tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_institutional_rules_deadline_clause_emits_time_constraint tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_time_list_children_emit_time_constraint_answer_role tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_time_intros_under_same_parent_emit_distinct_condition_group_ids tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_time_list_intro_with_below_deadlines_emits_typed_time_contract -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py --check`
- shared condition-subject keyword-rule owner cleanup:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_condition_subject_resolution_prefers_sports_competition_over_generic_competition tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_condition_subject_resolution_prefers_arts_competition_over_generic_competition -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py --check`
- shared action-type rule-table owner cleanup:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_action_type_resolution_supports_discipline_context_from_prefix_text tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_action_type_resolution_supports_discipline_context_from_document_title tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_action_type_resolution_does_not_promote_generic_discipline_reference tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_condition_subject_resolution_supports_discipline_context_from_title_and_section -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py tests/shared/test_regulation_semantic_registry.py --check`
- shared intro-scope and procedure-material owner cleanup:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/shared/test_answer_ready_evidence_contract.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
  - `tests/retrieval/evidence_attributes_suite.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_scope_resolution_prefers_target_roles tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_scope_resolution_supports_text_fallback tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_scope_conflicts_with_target_roles -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_procedure_materials_resolution_extracts_controlled_material_markers tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_accepts_typed_procedure_step -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.retrieval.evidence_attributes_suite -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py --check`
- shared intro-subject owner cleanup:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/shared/test_answer_ready_evidence_contract.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_subject_resolution_prefers_target_roles tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_group_id_conflicts_with_condition_subject tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_condition_subject_conflicts_with_target_roles -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_subject_resolution_prefers_target_roles tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_inline_example_groups_emit_distinct_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_mixed_condition_and_procedure_clause_uses_condition_group_anchor -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_package_facade_exports_v3_governance_constants tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_intro_subject_resolution_prefers_target_roles -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py --check`
- shared condition-polarity owner cleanup:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/shared/test_answer_ready_evidence_contract.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - `tests/ingestion/test_index_release_acceptance.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_expected_polarity_resolution_tracks_answer_role_and_table_type tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_answer_role_and_polarity_conflict tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_definition_and_table_fact_default_to_neutral_condition_polarity tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_typed_table_fact_polarity_is_positive_for_amount_and_timeline_queries -q`
    - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_package_facade_exports_v3_governance_constants tests.shared.test_regulation_semantic_registry.RegulationSemanticRegistryTest.test_shared_expected_polarity_resolution_tracks_answer_role_and_table_type -q`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/__init__.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py --check`
- grouped metadata bridge cleanup and intro group-id truth reuse:
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
  - `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - `tests/ingestion/processing_pipeline_policy_chunking_merge_suite.py`
  - `tests/shared/test_answer_ready_evidence_contract.py`
  - `tests/ingestion/test_index_release_acceptance.py`
  - verification:
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_answer_ready_piece_metadata_emits_group_ids_before_contract_builder tests.ingestion.processing_pipeline_policy_chunking_merge_suite.ProcessingPipelinePolicyChunkingMergeTest.test_final_chunk_metadata_does_not_leak_condition_group_bridge_keys -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_same_parent_multiple_rank_groups_emit_distinct_condition_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_answer_ready_piece_metadata_emits_group_ids_before_contract_builder tests.ingestion.processing_pipeline_policy_chunking_merge_suite.ProcessingPipelinePolicyChunkingMergeTest.test_final_chunk_metadata_does_not_leak_condition_group_bridge_keys -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_material_intros_under_same_parent_emit_distinct_condition_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_time_intros_under_same_parent_emit_distinct_condition_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_mixed_condition_and_procedure_clause_uses_condition_group_anchor tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_oracle_institutional_material_and_deadline_slices_freeze_group_contracts tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_group_id_conflicts_with_condition_subject tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_condition_group_id_conflicts_with_condition_subject -q`
    - `uv run --all-packages python -m unittest tests.ingestion.processing_pipeline_policy_chunking_merge_suite tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.shared.test_answer_ready_evidence_contract -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_bridge_only_group_keys_leak_into_final_metadata tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_bridge_group_key_leaks -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/processing_pipeline_policy_chunking_merge_suite.py`
    - `uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/processing_pipeline_policy_chunking_merge_suite.py --check`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_index_release_acceptance.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_index_release_acceptance.py --check`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_contract_builder_ignores_bridge_condition_group_key_in_final_metadata tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_contract_builder_ignores_bridge_intro_group_key_in_final_metadata -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_same_parent_multiple_rank_groups_emit_distinct_condition_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_material_intros_under_same_parent_emit_distinct_condition_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_time_intros_under_same_parent_emit_distinct_condition_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_answer_ready_piece_metadata_emits_group_ids_before_contract_builder tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_oracle_institutional_material_and_deadline_slices_freeze_group_contracts tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_bridge_only_group_keys_leak_into_final_metadata -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.processing_pipeline_policy_chunking_merge_suite tests.ingestion.test_institutional_regulation_semantic_regressions tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_condition_group_ids_do_not_match tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_intro_condition_group_id_conflicts -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_condition_group_id_points_to_different_parent tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_group_id_points_to_different_parent tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_condition_group_parent_conflicts tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_intro_group_parent_conflicts -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_condition_polarity_is_missing_for_procedure_step tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_missing_condition_polarity tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_category_overview_requires_generalized_member_registry_fields tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_category_overview_registry_conflicts tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_category_overview_registry_title_conflicts -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_category_overview_fails_without_typed_condition_subject_contract tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_category_overview_missing_typed_subject_contract -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.agent.rag_agent_answer_quality_regression_suite -q`
    - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
    - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.agent.rag_agent_answer_quality_regression_suite -q`
    - `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/ingestion/test_handbook_chunking_pipeline.py`
    - `uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/ingestion/test_handbook_chunking_pipeline.py --check`
    - `uv run --all-packages ruff check packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_index_release_acceptance.py`
    - `uv run --all-packages ruff format packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_index_release_acceptance.py --check`

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
- `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py`
- `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py`
- `tests/shared/test_regulation_semantic_registry.py`
- `tests/ingestion/test_handbook_chunking_pipeline.py`
- `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
- `tests/evals/retrieval_chunk_quality_suite.py`
- additional institutional oracle-backed extraction freeze:
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
  - coverage now explicitly freezes:
    - registry-backed `institutional_category_discovery` overview semantics
    - grouped `institutional_material_requirement` intro/child contract alignment
    - grouped `institutional_appeal_deadline` intro/child contract alignment
- verification:
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.evals.retrieval_chunk_quality_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.shared.test_regulation_semantic_registry tests.shared.test_regulation_semantic_regressions tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_index_release_acceptance -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_material_list_intro_with_submit_followed_by_children_emits_typed_material_contract tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_time_list_intro_with_below_deadlines_emits_typed_time_contract -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_oracle_institutional_material_and_deadline_slices_freeze_group_contracts tests.ingestion.test_institutional_regulation_semantic_regressions.InstitutionalRegulationSemanticRegressionsTest.test_oracle_institutional_category_discovery_slice_freezes_registry_backed_overview -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_handbook_chunking_pipeline tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
  - `uv run --all-packages python -m unittest tests.ingestion.test_institutional_regulation_semantic_regressions tests.ingestion.test_handbook_chunking_pipeline tests.shared.test_answer_ready_evidence_contract tests.shared.test_regulation_semantic_registry tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_handbook_chunking_pipeline.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/evals/retrieval_chunk_quality_suite.py --check`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/shared/src/campus_shared/regulation_semantic_registry.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/regulation_chunking.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_handbook_chunking_pipeline.py --check`

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
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_material_intros_under_same_parent_emit_distinct_condition_group_ids tests.ingestion.test_handbook_chunking_pipeline.HandbookChunkingPipelineTest.test_repeated_time_intros_under_same_parent_emit_distinct_condition_group_ids -q`
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
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_scope_conflicts_with_target_roles tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_intro_group_id_conflicts_with_condition_subject -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_condition_group_id_conflicts_with_condition_subject tests.shared.test_answer_ready_evidence_contract.AnswerReadyEvidenceContractTest.test_v3_validation_fails_when_procedure_group_id_conflicts_with_subject tests.ingestion.test_index_release_acceptance.IndexReleaseAcceptanceTest.test_release_chunk_quality_reports_condition_group_subject_conflicts -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.shared.test_regulation_semantic_registry tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite tests.retrieval.evidence_attributes_suite tests.retrieval.evidence_contract_ranking_suite tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_closeout_audit_suite -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/test_index_release_acceptance.py tests/ingestion/test_registry_scope_release_acceptance_wiring.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_attributes_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py packages/ingestion-core/src/campus_ingestion_core/index_release_acceptance.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py tests/shared/test_answer_ready_evidence_contract.py tests/shared/test_regulation_semantic_registry.py tests/ingestion/test_handbook_chunking_pipeline.py tests/ingestion/test_index_release_acceptance.py tests/ingestion/test_registry_scope_release_acceptance_wiring.py tests/evals/retrieval_chunk_quality_suite.py tests/retrieval/evidence_attributes_suite.py tests/retrieval/evidence_contract_ranking_suite.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_closeout_audit_suite.py --check`

Phase 8 evidence started:

- `packages/evals/src/campus_evals/answer_ready_component_eval.py`
- `packages/evals/src/campus_evals/answer_ready_component_runtime.py`
- `packages/ingestion-core/src/campus_ingestion_core/component_eval_release.py`
- `packages/ingestion-core/src/campus_ingestion_core/index_release.py`
- `packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py`
- `packages/ingestion-core/src/campus_ingestion_core/qdrant_backup.py`
- `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_lane.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/release_registry_scope.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/process_regulation_rag_release_candidates.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/admit_regulation_rag_release.py`
- `packages/evals/src/campus_evals/__init__.py`
- `packages/evals/fixtures/answer_ready_component_cases.v1.json`
- `tests/evals/answer_ready_component_eval_suite.py`
- `tests/evals/answer_ready_component_eval_runner_suite.py`
- `tests/evals/answer_ready_component_runtime_suite.py`
- `tests/ingestion/test_registry_scope_release_acceptance_wiring.py`
- `tests/ingestion/test_release_registry_scope_worker.py`
- `tests/ingestion/test_process_regulation_rag_release_candidates_worker.py`
- `tests/ingestion/test_regulation_rag_release_lane.py`
- `tests/ingestion/test_admit_regulation_rag_release_worker.py`
- `tests/ingestion/test_qdrant_backup.py`
- `tests/ingestion/test_index_release_acceptance.py`
- verification:
  - `uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_component_eval_runner_suite -q`
  - `uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_component_eval_runner_suite tests.evals.answer_ready_closeout_audit_suite tests.agent.rag_agent_realistic_e2e_samples_suite -q`
  - `uv run --all-packages python -m unittest tests.evals.answer_ready_component_runtime_suite -q`
  - `uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_component_eval_runner_suite tests.evals.answer_ready_component_runtime_suite tests.evals.answer_ready_closeout_audit_suite tests.agent.rag_agent_realistic_e2e_samples_suite -q`
  - `uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_component_eval_runner_suite tests.evals.answer_ready_component_runtime_suite tests.evals.answer_ready_closeout_audit_suite tests.agent.rag_agent_realistic_e2e_samples_suite tests.ingestion.test_registry_scope_release_acceptance_wiring tests.ingestion.test_release_registry_scope_worker tests.ingestion.test_process_regulation_rag_release_candidates_worker tests.ingestion.test_regulation_rag_release_lane tests.ingestion.test_admit_regulation_rag_release_worker tests.ingestion.test_qdrant_backup tests.ingestion.test_index_release_acceptance -q`
  - `uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_runner_suite tests.evals.answer_ready_component_runtime_suite -q`
  - `uv run --all-packages python -m unittest tests.evals.answer_ready_component_eval_suite tests.evals.answer_ready_component_eval_runner_suite tests.evals.answer_ready_component_runtime_suite tests.evals.answer_ready_closeout_audit_suite tests.agent.rag_agent_realistic_e2e_samples_suite -q`
  - `uv run --all-packages ruff check packages/evals/src/campus_evals/answer_ready_component_eval.py packages/evals/src/campus_evals/__init__.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_component_eval_runner_suite.py`
  - `uv run --all-packages ruff check packages/evals/src/campus_evals/answer_ready_component_runtime.py packages/evals/src/campus_evals/__init__.py tests/evals/answer_ready_component_runtime_suite.py`
  - `uv run --all-packages ruff check packages/evals/src/campus_evals/answer_ready_component_runtime.py tests/evals/answer_ready_component_eval_runner_suite.py tests/evals/answer_ready_component_runtime_suite.py`
  - `uv run --all-packages ruff check packages/evals/src/campus_evals/answer_ready_component_eval.py packages/evals/src/campus_evals/answer_ready_component_runtime.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_component_eval_runner_suite.py tests/evals/answer_ready_component_runtime_suite.py`
  - `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/component_eval_release.py packages/ingestion-core/src/campus_ingestion_core/index_release.py packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py packages/ingestion-core/src/campus_ingestion_core/qdrant_backup.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_lane.py apps/ingestion-worker/src/campus_ingestion_worker/release_registry_scope.py apps/ingestion-worker/src/campus_ingestion_worker/process_regulation_rag_release_candidates.py apps/ingestion-worker/src/campus_ingestion_worker/admit_regulation_rag_release.py tests/ingestion/test_registry_scope_release_acceptance_wiring.py tests/ingestion/test_release_registry_scope_worker.py tests/ingestion/test_process_regulation_rag_release_candidates_worker.py tests/ingestion/test_regulation_rag_release_lane.py tests/ingestion/test_admit_regulation_rag_release_worker.py tests/ingestion/test_qdrant_backup.py tests/ingestion/test_index_release_acceptance.py`
  - `uv run --all-packages ruff format packages/evals/src/campus_evals/answer_ready_component_runtime.py packages/evals/src/campus_evals/__init__.py tests/evals/answer_ready_component_runtime_suite.py --check`
  - `uv run --all-packages ruff format packages/evals/src/campus_evals/answer_ready_component_runtime.py tests/evals/answer_ready_component_eval_runner_suite.py tests/evals/answer_ready_component_runtime_suite.py --check`
  - `uv run --all-packages ruff format packages/evals/src/campus_evals/answer_ready_component_eval.py packages/evals/src/campus_evals/answer_ready_component_runtime.py tests/evals/answer_ready_component_eval_suite.py tests/evals/answer_ready_component_eval_runner_suite.py tests/evals/answer_ready_component_runtime_suite.py --check`
  - `uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/component_eval_release.py packages/ingestion-core/src/campus_ingestion_core/index_release.py packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py packages/ingestion-core/src/campus_ingestion_core/qdrant_backup.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_lane.py apps/ingestion-worker/src/campus_ingestion_worker/release_registry_scope.py apps/ingestion-worker/src/campus_ingestion_worker/process_regulation_rag_release_candidates.py apps/ingestion-worker/src/campus_ingestion_worker/admit_regulation_rag_release.py tests/ingestion/test_registry_scope_release_acceptance_wiring.py tests/ingestion/test_release_registry_scope_worker.py tests/ingestion/test_process_regulation_rag_release_candidates_worker.py tests/ingestion/test_regulation_rag_release_lane.py tests/ingestion/test_admit_regulation_rag_release_worker.py tests/ingestion/test_qdrant_backup.py tests/ingestion/test_index_release_acceptance.py --check`
  - `uv run --all-packages python -m unittest tests.ingestion.test_index_release_acceptance tests.ingestion.test_admit_regulation_rag_release_worker tests.ingestion.test_release_registry_scope_worker tests.ingestion.test_process_regulation_rag_release_candidates_worker tests.ingestion.test_registry_scope_release tests.ingestion.test_regulation_rag_release_lane -q`
  - `uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_lane.py apps/ingestion-worker/src/campus_ingestion_worker/admit_regulation_rag_release.py apps/ingestion-worker/src/campus_ingestion_worker/release_registry_scope.py apps/ingestion-worker/src/campus_ingestion_worker/process_regulation_rag_release_candidates.py tests/ingestion/test_index_release_acceptance.py tests/ingestion/test_admit_regulation_rag_release_worker.py tests/ingestion/test_release_registry_scope_worker.py tests/ingestion/test_process_regulation_rag_release_candidates_worker.py tests/ingestion/test_registry_scope_release.py tests/ingestion/test_regulation_rag_release_lane.py`
  - `uv run --all-packages ruff format packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_lane.py apps/ingestion-worker/src/campus_ingestion_worker/admit_regulation_rag_release.py apps/ingestion-worker/src/campus_ingestion_worker/release_registry_scope.py apps/ingestion-worker/src/campus_ingestion_worker/process_regulation_rag_release_candidates.py tests/ingestion/test_index_release_acceptance.py tests/ingestion/test_admit_regulation_rag_release_worker.py tests/ingestion/test_release_registry_scope_worker.py tests/ingestion/test_process_regulation_rag_release_candidates_worker.py tests/ingestion/test_registry_scope_release.py tests/ingestion/test_regulation_rag_release_lane.py --check`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages ruff check packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_index_release_acceptance.py`
  - `uv run --all-packages ruff format packages/shared/src/campus_shared/answer_ready_evidence_contract.py tests/shared/test_answer_ready_evidence_contract.py tests/ingestion/test_index_release_acceptance.py --check`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance -q`
  - `uv run --all-packages python -m unittest tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.ingestion.test_registry_scope_release_acceptance_wiring tests.evals.retrieval_chunk_quality_suite -q`
  - `uv run --all-packages python -m unittest tests.retrieval.backend_qdrant_release_guard_suite tests.retrieval.retrieval_service_replan_execution_suite tests.retrieval.evidence_contract_ranking_suite -q`
  - `uv run --all-packages python -m unittest tests.retrieval.retrieval_service_replan_execution_suite tests.agent.rag_agent_agentic_depth_runtime_suite tests.agent.test_rag_retrieval_plan -q`
  - `uv run --all-packages ruff check packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_release_guard.py tests/retrieval/backend_qdrant_release_guard_suite.py`
  - `uv run --all-packages ruff check packages/retrieval-core/src/campus_retrieval_core/service_execution.py packages/retrieval-core/src/campus_retrieval_core/models.py packages/rag-agent/src/campus_rag_agent/semantic_replan.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py tests/retrieval/retrieval_service_replan_execution_suite.py tests/retrieval/retrieval_service_test_support.py tests/agent/rag_agent_agentic_depth_runtime_suite.py tests/agent/rag_agent_test_support.py tests/agent/test_rag_retrieval_plan.py`
  - `uv run --all-packages ruff format packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_release_guard.py tests/retrieval/backend_qdrant_release_guard_suite.py --check`
  - `uv run --all-packages ruff format packages/retrieval-core/src/campus_retrieval_core/service_execution.py packages/retrieval-core/src/campus_retrieval_core/models.py packages/rag-agent/src/campus_rag_agent/semantic_replan.py packages/rag-agent/src/campus_rag_agent/service_retrieval.py tests/retrieval/retrieval_service_replan_execution_suite.py tests/retrieval/retrieval_service_test_support.py tests/agent/rag_agent_agentic_depth_runtime_suite.py tests/agent/rag_agent_test_support.py tests/agent/test_rag_retrieval_plan.py --check`

Phase 9 evidence:

- `phases/phase-09-student-rules-rebuild-release-audit/SUMMARY.md`
- `phases/phase-09-student-rules-rebuild-release-audit/artifacts/student_rules_runtime_probe_v1.json`
- `phases/phase-09-student-rules-rebuild-release-audit/artifacts/student_rules_re_audit_report_v1.json`
- release object-store keys:
  - `regulations/releases/student_rules/r20260507_154528_764347_1005cea7/index-release.json`
  - `regulations/operations/regulation-rag-release-admission/adm-20260507-154500/student_rules/release-admission.json`
  - `regulations/releases/student_rules/r20260507_154528_764347_1005cea7/component-eval-summary.json`
  - `regulations/releases/student_rules/r20260507_154528_764347_1005cea7/retrieval-acceptance-summary.json`
  - `regulations/releases/student_rules/r20260507_154528_764347_1005cea7/post-publish-audit-summary.json`
- verification:
  - `uv run --all-packages python -m unittest tests.ingestion.test_registry_scope_release.RegistryScopeReleaseTest.test_post_publish_audit_includes_component_eval_closeout_counts tests.ingestion.test_release_registry_scope_worker.ReleaseRegistryScopeWorkerCliTest.test_main_loads_component_eval_summary_and_passes_it_into_registry_scope_release tests.ingestion.test_re_audit_regulation_rag_release_worker.ReAuditRegulationRagReleaseWorkerCliTest.test_main_rewrites_post_publish_audit_for_existing_release -q`
  - `uv run --all-packages python -m campus_ingestion_worker.re_audit_regulation_rag_release --corpus regulations --collection student_rules --release-id r20260507_154528_764347_1005cea7`
  - `uv run --all-packages python -m campus_ingestion_worker.probe_regulation_rag_release_runtime --scope regulations/student_rules`

Phase 10 evidence:

- `phases/phase-10-institutional-rules-rebuild-release-audit/SUMMARY.md`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_prepare_registry_scope_chunks_report_v3.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_release_admission_report_v9.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_registry_scope_release_report_v9.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_runtime_probe_v4.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_re_audit_report_v3.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_release_manifest_field_audit_v3.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_preview_component_eval_summary.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_qdrant_gc_delete_r20260507_160544_038218_5df5b8b0.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_qdrant_gc_delete_r20260507_182003_116643_6af76967.json`
- `phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/qdrant_gc_preview_candidates_space_recovery.jsonl`
- verification:
  - `uv run --all-packages python -m unittest tests.ingestion.test_handbook_chunking_pipeline tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_index_release_acceptance tests.ingestion.test_institutional_regulation_semantic_regressions tests.shared.test_regulation_semantic_regressions -q`
  - `uv run --all-packages python -m campus_ingestion_worker.prepare_registry_scope_chunks --corpus regulations --collection institutional_rules --preparation-run-id prep-20260508-022800`
  - `uv run --all-packages python -m campus_ingestion_worker.admit_regulation_rag_release --corpus regulations --collection institutional_rules --preparation-run-id prep-20260508-022800 --admission-run-id admit-20260508-institutional-rules-v7 --component-eval-summary-path .planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_preview_component_eval_summary.json`
  - `uv run --all-packages python -m campus_ingestion_worker.release_registry_scope --corpus regulations --collection institutional_rules --preparation-run-id prep-20260508-022800 --release-admission-manifest-key regulations/operations/regulation-rag-release-admission/admit-20260508-institutional-rules-v7/institutional_rules/release-admission.json --acceptance-case-path packages/evals/fixtures/institutional_rules_release_acceptance.v1.json --component-eval-summary-path .planning/workstreams/answer-ready-semantic-extraction-rearchitecture/phases/phase-10-institutional-rules-rebuild-release-audit/artifacts/institutional_rules_preview_component_eval_summary.json --publish-alias`
  - `uv run --all-packages python -m campus_ingestion_worker.probe_regulation_rag_release_runtime --scope regulations/institutional_rules`
