---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Semantic Oracle

## Purpose

This oracle freezes expected semantic behavior before implementation. Later phases may add rows, but
they must not weaken or silently reinterpret these expectations.

## Oracle Fields

Each row defines:

- `case_id`
- `collection`
- `query`
- `expected_task_kind`
- `expected_query_polarity`
- `expected_answer_role`
- `expected_condition_subject`
- `expected_condition_group_behavior`
- `expected_top_evidence_roles`
- `expected_draft_kind`
- `expected_grounding`
- `expected_document_or_category_coverage`
- `failure_stage_if_missing`

## Student Rules Rows

| Case | Query | Task | Polarity | Answer Role | Condition Subject | Group Behavior | Top Evidence Roles | Draft | Grounding |
|------|-------|------|----------|-------------|-------------------|----------------|--------------------|-------|-----------|
| `student_discipline_relief_procedure` | 处分怎么消 | `procedure_lookup` | positive | `procedure_step` | `application_procedure` | procedure steps share stable discipline-relief group | `procedure_step` before `exclusion_rule` | `procedure_steps` | every step cites evidence |
| `student_discipline_relief_exclusion` | 哪些情况不能解除处分 | `restriction_lookup` | negative | `exclusion_rule` | `discipline_relief_exclusion` | exclusion group under same parent article | `exclusion_rule` | `condition_table` | each exclusion cites evidence |
| `student_national_scholarship_rank` | 成绩没前十还能评国奖吗 | `eligibility_judgment` | positive | `eligibility_condition` or `exception_rule` | `rank_threshold` | rank group distinct from paper group | `eligibility_condition`, `exception_rule` | `eligibility_judgment` | judgment cites rank/exception evidence |
| `student_national_scholarship_paper` | 论文能不能算国奖条件 | `eligibility_judgment` | positive | `example_evidence` or `eligibility_condition` | `paper_or_publication` | paper/publication group distinct from rank group | `example_evidence`, `eligibility_condition` | `eligibility_judgment` | judgment cites paper/publication evidence |
| `student_scholarship_discovery` | 本科生有哪些奖学金能申请 | `category_discovery` | neutral | `category_overview` | `audience_scope` | category overview has member policy ids/titles | `category_overview` | `policy_list` | each listed policy cites overview or member evidence |
| `student_scholarship_amount_table_fact` | 专业奖学金一等奖金额是多少 | `specific_policy_lookup` | positive | `table_fact` | `amount_or_quota` | table fact stays distinct from generic scholarship overview | `table_fact` before `eligibility_condition` | `condition_table` | amount/quota row cites answer-ready table evidence |
| `student_scholarship_apply_ambiguous` | 奖学金怎么申请 | `clarification_or_bounded_procedure` | neutral | `clarification` or `procedure_step` | `application_procedure` | no fabricated single scholarship procedure | `procedure_step` only after category/type resolved | `clarification` | clarification must not cite unsupported procedure |
| `student_card_reissue` | 学生证丢了怎么补 | `procedure_lookup` | positive | `procedure_step` | `application_procedure` | reissue procedure group | `procedure_step` | `procedure_steps` | every step cites evidence |
| `student_rules_no_hit` | 校内宇宙签证办理处 | `unsupported_or_no_hit` | neutral | `unsupported` |  | no fabricated policy resolution | no answer-bearing evidence | `unsupported` | must not fabricate citations or resolved policy clauses |

## Institutional Rules Rows

Phase 0 requires a small institutional denominator before implementation. The concrete document ids
are frozen in `INSTITUTIONAL-DENOMINATOR.md`; this oracle freezes semantic shapes.

| Case | Query | Task | Polarity | Answer Role | Condition Subject | Group Behavior | Top Evidence Roles | Draft | Grounding |
|------|-------|------|----------|-------------|-------------------|----------------|--------------------|-------|-----------|
| `institutional_appeal_procedure` | 校级申诉怎么走流程 | `procedure_lookup` | positive | `procedure_step` | `application_procedure` | appeal procedure group | `procedure_step` | `procedure_steps` | every step cites evidence |
| `institutional_appeal_deadline` | 申诉有时间限制吗 | `eligibility_judgment` | positive | `time_constraint` or `eligibility_condition` | `deadline` | deadline group distinct from materials | `time_constraint`, `eligibility_condition` | `condition_table` | deadline cites evidence |
| `institutional_material_requirement` | 申请复核要交什么材料 | `procedure_lookup` | positive | `material_requirement` | `material_requirement` | material group linked to procedure parent | `material_requirement`, `procedure_step` | `condition_table` | each material cites evidence |
| `institutional_category_discovery` | 学校层面的学生管理制度有哪些 | `category_discovery` | neutral | `category_overview` | `audience_scope` | category overview has member document ids/titles | `category_overview` | `policy_list` | each listed policy cites overview/member evidence |
| `institutional_rules_no_hit` | 中央民族大学星际通勤飞船管理办法 | `unsupported_or_no_hit` | neutral | `unsupported` |  | no fabricated institutional policy resolution | no answer-bearing evidence | `unsupported` | must not fabricate citations or resolved policy clauses |

## Failure Attribution

- wrong intent -> `intent_mismatch`
- expected document/category absent from candidates -> `retrieval_miss`
- wrong evidence role ranked first -> `ranking_mismatch`
- selected evidence is intro/weak/fallback-only -> `selection_not_answer_ready`
- selected metadata mismatches oracle role/subject/polarity/group -> `semantic_contract_mismatch`
- typed draft kind wrong -> `draft_contract_mismatch`
- claim/list/step lacks support -> `grounding_mismatch`
- release artifact missing contract status -> `release_contract_missing`
