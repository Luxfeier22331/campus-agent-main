---
doc_type: gap_ledger
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Answer-Ready Evidence Contract Closeout

## Completion Audit

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Query-serving regulation-family release gate fails closed when answer-ready fields are missing | closed | `packages/shared/src/campus_shared/answer_ready_evidence_contract.py`, `packages/ingestion-core/src/campus_ingestion_core/answer_ready_contract_quality.py`, `packages/ingestion-core/src/campus_ingestion_core/regulation_rag_release_admission.py`, `packages/ingestion-core/src/campus_ingestion_core/registry_scope_release.py`, `tests/ingestion/test_index_release_acceptance.py`, `tests/ingestion/test_registry_scope_release_acceptance_wiring.py` |
| Retrieval projection preserves `answer_role`, `condition_subject`, `parent_unit_id`, `evidence_contract_version` and existing semantic fields | closed | `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`, `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant_evidence.py`, `tests/retrieval/evidence_attributes_suite.py`, `tests/evals/answer_ready_closeout_audit_suite.py` |
| Procedure chunks carry typed procedure metadata | closed | `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`, `tests/ingestion/test_handbook_chunking_pipeline.py`, `tests/evals/answer_ready_closeout_audit_suite.py` |
| Category overview chunks carry typed category metadata | closed | `packages/ingestion-core/src/campus_ingestion_core/process_candidate_postprocess.py`, `packages/ingestion-core/src/campus_ingestion_core/regulation_semantics.py`, `tests/ingestion/test_handbook_chunking_pipeline.py`, `tests/evals/answer_ready_closeout_audit_suite.py` |
| Eligibility / condition evidence carries typed subject metadata where possible | closed | `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`, `packages/ingestion-core/src/campus_ingestion_core/regulation_answer_roles.py`, `tests/ingestion/test_handbook_chunking_pipeline.py`, `tests/evals/answer_ready_closeout_audit_suite.py` |
| Ranking and selection use typed metadata as the primary signal | closed | `packages/retrieval-core/src/campus_retrieval_core/evidence_semantics.py`, `packages/retrieval-core/src/campus_retrieval_core/evidence_ranking_features.py`, `tests/evals/answer_ready_closeout_audit_suite.py`, `tests/retrieval/retrieval_service_replan_execution_suite.py` |
| Runtime text cues remain legacy diagnostics, not target rebuilt `student_rules` primary signal | closed | `packages/retrieval-core/src/campus_retrieval_core/evidence_attributes.py`, `tests/evals/answer_ready_closeout_audit_suite.py`; closeout audit asserts `primary_text_cue_fallback_count == 0` |
| Typed answer drafts cover policy list, procedure, eligibility judgment, condition table, unsupported and clarification shapes | closed | `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`, `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`, `tests/agent/rag_agent_typed_answer_drafts_suite.py` |
| Component eval can attribute stage-local failures | closed | `packages/evals/src/campus_evals/answer_ready_component_eval.py`, `tests/evals/answer_ready_component_eval_suite.py` |
| Target regression cases are covered | closed | `tests/evals/answer_ready_closeout_audit_suite.py`, `tests/agent/rag_agent_realistic_e2e_samples_suite.py`, `tests/agent/rag_agent_answer_quality_regression_suite.py` |

## Phase 6 Findings Closed

| Finding | Root Cause | Fix |
|---------|------------|-----|
| `处分怎么消` procedure evidence had `condition_subject=material_requirement` | `infer_condition_subject` let material cues override `answer_role=procedure_step` | `procedure_step` now emits `condition_subject=application_procedure` before cue-specific subjects |
| `不予解除处分` was classified as exception-like generic condition | coarse handbook semantics marked negative “情形” as exception before answer-role release correction | high-confidence parser `exclusion_rule` now overrides coarse semantics, and discipline relief exclusion gets `condition_subject=discipline_relief_exclusion` |
| rank exception and paper example merged into one evidence chunk | adjacent short textual merge did not block answer-ready atomic evidence before final metadata was materialized | short-textual merge now resolves candidate answer role from metadata or parser and refuses to merge atomic answer-ready roles |
| scholarship category discovery audit missed overview evidence | synthetic closeout fixture used a non-registry document id | closeout audit now combines target synthetic clauses with the real scholarship registry overview document fixture |

## Institutional Rules Decision

`institutional_rules` is covered by the reusable regulation-family contract definition and release
quality gate compatibility tests. This is not a claim that production `institutional_rules` serving
alias has already been rebuilt or switched; that must still happen through the regulation RAG release
lane with matching admission evidence.

## Remaining Boundaries

- This ledger records current worktree closeout evidence, not a claim that the production serving
  alias has already been rebuilt or switched.
- Production backfill / publish must continue through the regulation RAG release lane with a
  matching release admission manifest and `answer_ready_contract_status=passed`.
- No supervisor routing, Agents SDK tool schema, freshness/live branch or query-enabled surface was
  reopened.
