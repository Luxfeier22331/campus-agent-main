---
doc_type: eval_contract
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Eval Contract: Stage-Local Answer-Ready Evidence Checks

Phase 5 must implement this component eval contract. The schema is frozen in Phase 0 so Phase 1-4
implementation has a stable target.

## Failure Taxonomy

| Failure Class | Stage Owner | Meaning |
| --- | --- | --- |
| `intent_mismatch` | planner / query intent | Query task, polarity, answer role, category or condition subject is wrong. |
| `retrieval_miss` | retrieval | Expected document/version/chunk is absent from candidate evidence. |
| `ranking_mismatch` | retrieval ranking | Expected answer-ready evidence exists but is ranked below conflicting/weak evidence. |
| `selection_not_answer_ready` | rag-agent evidence selection | Selected support is intro, procedure, ratio, duplicate parent, or wrong polarity when typed alternative exists. |
| `draft_contract_mismatch` | rag-agent synthesis | Typed draft kind/items/steps/judgment do not match evidence contract. |
| `grounding_mismatch` | rag-agent grounding | Draft claim/list/step lacks source id, chunk id or excerpt support in claim/evidence graph. |
| `chunk_contract_missing` | ingestion/evals/release | Required answer-ready metadata is missing before or during release admission. |

## Component Case Fields

| Field | Required | Purpose |
| --- | --- | --- |
| `case_id` | yes | Stable case identifier. |
| `query` | yes | User-facing Chinese query. |
| `collection` | yes | Initial target is `student_rules`. |
| `expected_task_kind` | yes | `specific_policy_lookup`, `category_discovery`, `ambiguous_procedure` or `unsupported_or_no_hit`. |
| `expected_query_polarity` | yes | `positive`, `negative` or `neutral`. |
| `expected_answer_role` | yes | Target evidence role family. |
| `expected_condition_subject` | conditional | Required for judgment/condition cases. |
| `expected_document_ids` | conditional | Required for specific lookup or judgment cases. |
| `expected_min_category_coverage` | conditional | Required for category discovery cases. |
| `expected_top_evidence_roles` | yes | Role(s) expected in top/ranked evidence. |
| `expected_draft_kind` | yes | `policy_list`, `procedure_steps`, `eligibility_judgment`, `condition_table`, `unsupported` or `clarification`. |
| `expected_grounding` | yes | Whether claim/list/step support must be present. |

## Target Regression Matrix

| Case | Expected Task | Expected Evidence | Draft Kind | Primary Guard |
| --- | --- | --- | --- | --- |
| `处分怎么消` | `specific_policy_lookup` | positive `procedure_step`, action `lift_discipline` | `procedure_steps` | Negative exclusion must not outrank positive procedure. |
| `哪些情况不能解除处分` | `specific_policy_lookup` | negative `exclusion_rule` / `exception_rule` | `condition_table` | Negative restriction must remain valid for negative query. |
| `成绩没前十还能评国奖吗` | `specific_policy_lookup` | `condition_subject=rank_threshold` | `eligibility_judgment` | Ranking/selection must not trim away rank threshold. |
| `论文能不能算国奖条件` | `specific_policy_lookup` | `condition_subject=paper_or_publication` | `eligibility_judgment` | Paper/publication evidence must be selected. |
| `本科生有哪些奖学金能申请` | `category_discovery` | `category_overview`, multi-policy coverage | `policy_list` | Must not clarify or overclaim eligibility. |
| `奖学金怎么申请` | `ambiguous_procedure` | no answer draft without procedure target | `clarification` | Clarification remains valid. |

## Phase 5 Implementation Rule

RAGAS remains diagnostic. A target case must be able to fail at exactly one primary component class
above without requiring RAGAS scoring to explain the failure.
