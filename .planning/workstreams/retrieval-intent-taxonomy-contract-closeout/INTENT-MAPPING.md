---
doc_type: mapping
status: active
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Intent Mapping: Current Classifiers To RetrievalIntent

## Current Dispositions

| Current owner | Current value / signal | RetrievalIntent kind | Disposition |
| ------------- | ---------------------- | -------------------- | ----------- |
| `HandbookQueryPlan.task_kind` | `category_discovery` | `policy_list` | Kept as read-only projection until residual deletion. |
| `HandbookQueryPlan.task_kind` | `specific_policy_lookup` + article/detail focus | `specific_clause_lookup` | Intent projection owns answer/retrieval downstream meaning. |
| `HandbookQueryPlan.task_kind` | `specific_policy_lookup` + judgment cue | `eligibility_judgment` | Intent projection owns answer/retrieval downstream meaning. |
| `HandbookQueryPlan.task_kind` | `specific_policy_lookup` + procedure cue | `procedure_steps` | Intent projection owns answer/retrieval downstream meaning. |
| `HandbookQueryPlan.task_kind` | `specific_policy_lookup` + condition cue | `condition_table` | Intent projection owns answer/retrieval downstream meaning. |
| `HandbookQueryPlan.status` | `needs_clarification` | `clarification_required` | Clarification remains fail-closed before retrieval. |
| `HandbookQueryPlan.task_kind` | `unsupported_or_no_hit` | `unsupported` | Unsupported remains explicit terminal intent. |
| `InstitutionalRulesQueryPlan.mode` | `default_public_service` | `policy_list` | Intent projection owns public-service category/member coverage. |
| `InstitutionalRulesQueryPlan.mode` | `governance_targeted` | `policy_object_lookup` | Intent projection owns targeted institutional policy lookup. |
| `CurriculumQueryPlan` | any non-terminal curriculum lookup | `curriculum_fact_lookup` | Current phase creates projection only. |
| `CurriculumQueryPlan.status` | `needs_clarification` | `clarification_required` | Clarification remains pre-retrieval. |
| `CurriculumQueryPlan.status` | `unsupported` | `unsupported` | Unsupported remains pre-retrieval. |
| `CurriculumCourseQueryPlan` | resolved course/family fact | `curriculum_fact_lookup` | Current phase creates projection only. |
| `CurriculumProgramFamilyQueryPlan` | resolved family fact | `curriculum_fact_lookup` | Current phase creates projection only. |
| official-web stable reference | admitted stable reference scope | `official_reference_lookup` | Projection helper exists; there is no separate official-web plan owner. |
| `AnswerShape` | all values | derived in Phase 3 | Must become projection from `RetrievalIntent`. |
| SDK `RagTaskKind` | all values | derived in Phase 3/7 convergence | Must stop classifying from raw query text. |
| `TypedAnswerDraft.kind` | all values | derived in Phase 3/7 | Must align with `RetrievalIntent.expected.answer_kind`. |
| retrieval need ids / expected outputs | scattered plan logic | derived in Phase 4 | rag-agent derives typed plan fields; retrieval-core remains executor. |
| semantic replan trigger reasons | generic/failure-derived | derived in Phase 5 | rag-agent adds intent-aware gap checks. |

## Phase 1/2 Implemented Projections

- `HandbookQueryPlan.retrieval_intent`
- `InstitutionalRulesQueryPlan.retrieval_intent`
- `CurriculumQueryPlan.retrieval_intent`
- `CurriculumCourseQueryPlan.retrieval_intent`
- `CurriculumProgramFamilyQueryPlan.retrieval_intent`
- `retrieval_intent_for_official_web_stable_reference(...)`

## Deferred Projection Rewrites

- `AnswerShape` still has independent regulation query/evidence inference until Phase 3.
- SDK `RagTaskKind` still has raw query mapping until the SDK synthesis convergence step.
- Retrieval planning still uses existing `handbook_plan` and scope-specific fields until Phase 4.
- Selection/replan still rely on current generic semantic checks until Phase 5.
