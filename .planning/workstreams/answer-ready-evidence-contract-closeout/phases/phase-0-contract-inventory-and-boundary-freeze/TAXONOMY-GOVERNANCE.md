---
doc_type: taxonomy_governance
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Taxonomy Governance: Answer-Ready Evidence

This document freezes the vocabulary governance for answer-ready evidence fields before Phase 1.

## Contract Version

- Initial version: `answer_ready_evidence.v1`
- Field owner: `packages/ingestion-core` produces metadata; `packages/retrieval-core` owns online
  projection/ranking consumption; `packages/rag-agent` owns draft/grounding consumption.
- New enum values require tests in ingestion, retrieval ranking/selection and component eval.

## Answer Role Vocabulary

| Value | Meaning | Primary Consumer |
| --- | --- | --- |
| `procedure_step` | Actionable step in a process. | procedure ranking, procedure draft |
| `exclusion_rule` | Negative prohibition or ineligible condition. | negative query ranking, condition table |
| `exception_rule` | Exception or override condition. | judgment / condition table |
| `eligibility_intro` | Introductory eligibility text, not sufficient alone. | selection rejection unless no alternative |
| `eligibility_condition` | Answerable eligibility or condition clause. | judgment / condition table |
| `example_evidence` | Example/list item supporting a condition. | judgment support |
| `category_overview` | Registry-derived overview of member policy documents. | policy list draft |
| `policy_list` | Explicit policy list evidence. | policy list draft |
| `table_fact` | Answer-ready table row/fact. | condition table / amount / quota |
| `time_constraint` | Deadline or time window. | condition table / procedure |
| `definition` | Definition clause. | condition table / explanation |
| `supporting_detail` | Non-primary supporting detail. | fallback only |

## Condition Subject Vocabulary

| Value | Meaning |
| --- | --- |
| `rank_threshold` | Academic ranking threshold such as top 10% / top 30%. |
| `paper_or_publication` | Paper, publication, work, patent or competition exception evidence. |
| `material_requirement` | Required application materials or proofs. |
| `deadline` | Deadline, public notice period or time window. |
| `audience_scope` | Undergraduate, grade, cohort, major or eligible audience. |
| `discipline_relief_condition` | Positive condition for lifting discipline punishment. |
| `discipline_relief_exclusion` | Negative restriction for lifting discipline punishment. |
| `application_procedure` | Procedure-specific condition or step prerequisite. |
| `amount_or_quota` | Award amount, count, quota or proportion. |
| `generic_condition` | Deterministic condition that does not fit a narrower value yet. |
| `unknown` | Metadata absent or not deterministically classifiable. |

## Unknown / Generic Handling

- `unknown` is allowed for old indexes and non-target chunks, but not for rebuilt target regression
  chunks where the expected condition subject is known.
- `generic_condition` is allowed only when the condition is answerable but no stable narrower subject
  exists.
- Do not add one-off values named after a single user query, policy title or local phrase. Add a
  reusable subject only when at least one eval case and one ingestion fixture prove the need.

## Related Fields

- `condition_polarity` uses `positive`, `negative`, `neutral` or `unknown`.
- `condition_group_id` groups sibling conditions under the same parent unit.
- `procedure_actor`, `procedure_action`, `procedure_materials` and `procedure_next_actor` are typed
  attributes, not replacements for `answer_role=procedure_step`.
