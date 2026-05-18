---
doc_type: phase_summary
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Summary: Phase 2 Taxonomy And Registry Normalization

## Result

Phase 2 now has explicit completion-audit evidence. Subject/category/procedure semantics are no
longer owned as ingestion-private constants or scholarship-only patches. Shared registry/taxonomy
owners in `packages/shared` now govern canonical values, alias handling, coverage expectations and
taxonomy-versioned contract fields consumed by ingestion, retrieval and typed answer drafting.

This summary records audit evidence for the Phase 2 plan. The overall workstream remains active
under Phase 11 closeout.

## Evidence Surfaces

- implementation:
  - `packages/shared/src/campus_shared/regulation_semantic_registry.py`
  - `packages/shared/src/campus_shared/regulation_semantic_patterns.py`
  - `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`
  - `packages/shared/src/campus_shared/__init__.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
  - `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`
  - `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`
- registry/taxonomy proof:
  - `tests/shared/test_regulation_semantic_registry.py`
  - `tests/shared/test_answer_ready_evidence_contract.py`
- ingestion/regression proof:
  - `tests/ingestion/test_handbook_chunking_pipeline.py`
  - `tests/ingestion/test_institutional_regulation_semantic_regressions.py`
- category-discovery runtime proof:
  - `tests/agent/rag_agent_handbook_category_discovery_suite.py`
  - `tests/agent/rag_agent_typed_answer_drafts_suite.py`

## Exit-Criteria Evidence

- Shared owner exists for canonical subject/category/procedure vocabularies with governance
  metadata:
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_taxonomy_definitions_carry_governance_metadata`
  - `tests/shared/test_answer_ready_evidence_contract.py::test_package_facade_exports_v3_governance_constants`
- Generalized category registry is not scholarship-only:
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_student_rules_registry_covers_non_scholarship_categories`
  - `tests/shared/test_answer_ready_evidence_contract.py::test_category_overview_requires_generalized_member_registry_fields`
- Shared condition-subject owner canonicalizes aliases and prefers structured metadata over local
  text-cue ordering:
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_condition_subject_canonicalization_handles_legacy_aliases`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_condition_subject_resolution_prefers_structured_group_subject`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_condition_subject_resolution_prefers_structured_intro_subject`
  - `tests/shared/test_regulation_semantic_registry.py::test_condition_subject_resolution_prefers_sports_competition_over_generic_competition`
  - `tests/shared/test_regulation_semantic_registry.py::test_condition_subject_resolution_prefers_arts_competition_over_generic_competition`
- Shared procedure action and actor vocabularies are controlled and reusable:
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_procedure_action_resolution_prefers_explicit_metadata`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_procedure_action_resolution_supports_guidance_duty_steps`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_procedure_actor_resolution_supports_student_rule_procedure_clause`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_procedure_actor_resolution_supports_institutional_office_clause`
  - `tests/shared/test_answer_ready_evidence_contract.py::test_v3_validation_fails_when_procedure_actor_is_unknown`
  - `tests/shared/test_answer_ready_evidence_contract.py::test_v3_validation_fails_when_procedure_next_actor_is_unknown`
- Shared intro/list/heading/category hints are owned centrally instead of duplicated in ingestion:
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_intro_list_role_hint_resolves_material_list_variants`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_intro_list_role_hint_distinguishes_procedure_list`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_heading_role_hint_resolves_procedure_category_headings`
  - `tests/shared/test_regulation_semantic_registry.py::test_shared_heading_role_hint_resolves_generic_category_heading`
- Category discovery consumes shared registry-backed category truth instead of document-local
  special casing:
  - `tests/agent/rag_agent_handbook_category_discovery_suite.py::test_category_discovery_enters_retrieval_with_category_policy_set`
  - `tests/agent/rag_agent_handbook_category_discovery_suite.py::test_category_discovery_prefers_overview_source_over_exclusion_clause`
  - `tests/agent/rag_agent_typed_answer_drafts_suite.py::test_category_discovery_policy_list_can_be_completed_from_registry_backed_member_document`

## Verification

```bash
uv run --all-packages python -m unittest tests.shared.test_regulation_semantic_registry tests.shared.test_answer_ready_evidence_contract tests.ingestion.test_handbook_chunking_pipeline tests.ingestion.test_institutional_regulation_semantic_regressions tests.agent.rag_agent_handbook_category_discovery_suite tests.agent.rag_agent_typed_answer_drafts_suite -q
```

Result: the closeout session verified the shared registry/taxonomy owner path together with
ingestion and category-discovery consumption; the targeted category-discovery regression fix also
passed in the same lane.

```bash
uv run --all-packages ruff check packages/shared/src/campus_shared/regulation_semantic_registry.py packages/shared/src/campus_shared/answer_ready_evidence_contract.py packages/shared/src/campus_shared/__init__.py packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py tests/shared/test_regulation_semantic_registry.py tests/shared/test_answer_ready_evidence_contract.py tests/agent/rag_agent_handbook_category_discovery_suite.py tests/agent/rag_agent_typed_answer_drafts_suite.py
```

Result: targeted touched-file lint passed in the closeout session.

## Residual Gaps

- Phase 2 planned owner/governance coverage is now explicitly evidenced.
- Broader workstream closure still depends on Phase 11 planning/docs closeout and cross-phase
  release verification.
