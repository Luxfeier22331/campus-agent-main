---
doc_type: contract_freeze
status: active
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Contract Freeze: RetrievalIntent v1

## Placement

`RetrievalIntent` v1 is an internal RAG/retrieval seam model owned by `packages/rag-agent`.

It is not a `packages/contracts` shared model. It must not be imported by browser/API/supervisor
surfaces, and retrieval-core must not import it. retrieval-core continues to execute typed
`RetrievalPlan` / `RetrievalStep` fields derived by rag-agent.

## Current Implementation

Primary implementation:

- `packages/rag-agent/src/campus_rag_agent/retrieval_intent.py`

Current projection owners:

- `HandbookQueryPlan.retrieval_intent`
- `InstitutionalRulesQueryPlan.retrieval_intent`
- `CurriculumQueryPlan.retrieval_intent`
- `CurriculumCourseQueryPlan.retrieval_intent`
- `CurriculumProgramFamilyQueryPlan.retrieval_intent`
- `retrieval_intent_for_official_web_stable_reference(...)`

## Schema

```text
RetrievalIntent
- schema_version: 1
- kind
- normalized_query
- expected: RetrievalIntentExpectation
- target: RetrievalIntentTarget
- critical_terms[]
- clarification_reason
- unsupported_reason

RetrievalIntentExpectation
- answer_kind
- evidence_roles[]
- coverage_policy
- selection_policy
- rerank_policy
- replan_policy

RetrievalIntentTarget
- corpus
- collection
- document_ids[]
- preferred_document_ids[]
- version_ids[]
- revision_track
- article_nos[]
- clause_nos[]
- detail_labels[]
- focus_terms[]
- category_id
- category_member_document_ids[]
- condition_subject
```

## Frozen V1 Enum Values

`kind`:

- `policy_list`
- `policy_object_lookup`
- `specific_clause_lookup`
- `eligibility_judgment`
- `procedure_steps`
- `condition_table`
- `version_compare`
- `curriculum_fact_lookup`
- `official_reference_lookup`
- `general_fact_lookup`
- `clarification_required`
- `unsupported`

`answer_kind`:

- `policy_list`
- `policy_object`
- `specific_clause`
- `eligibility_judgment`
- `procedure_steps`
- `condition_table`
- `version_compare`
- `curriculum_fact`
- `official_reference`
- `general_fact`
- `clarification`
- `unsupported`

`coverage_policy`:

- `none`
- `single_document_focus`
- `category_member_coverage`
- `condition_subject_alignment`
- `procedure_step_completeness`
- `version_pair_coverage`

`selection_policy`:

- `default`
- `answer_role_first`
- `one_answer_ready_source_per_member`
- `focused_clause_first`
- `official_reference_first`

`rerank_policy`:

- `profile_gated_if_eligible`
- `disabled`

`replan_policy`:

- `none`
- `intent_gap_replan`
- `coverage_gap_replan`
- `focus_gap_replan`

## Required Target Rules

- `policy_list` requires `category_id`.
- `policy_object_lookup`, `specific_clause_lookup`, `eligibility_judgment`, `procedure_steps` and
  `condition_table` require `document_ids`.
- `version_compare` requires at least two `version_ids`.
- `clarification_required` requires `clarification_reason`.
- `unsupported` requires `unsupported_reason`.

## Non-Goals

- No provider/SDK/Qdrant/MinIO/object-store types.
- No shared `packages/contracts` placement.
- No public API response shape change.
- No query-serving surface expansion.
- No retrieval-core ownership of primary RAG intent.
- No live/freshness branch reopening.
