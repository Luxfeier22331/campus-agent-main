---
doc_type: phase_summary
status: completed
workstream: regulation-rag-release-lane
phase: phase-11-selected-school-level-regulation-admission
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Phase 11 Summary: Selected School-Level Regulation Admission

## Outcome

12 school-level regulations from the scoped holding set were explicitly
re-admitted into `regulations/institutional_rules` downstream consumption truth.
This expands the tracked institutional consumption set from 30 to 42 documents
without globally opening `regulations/scoped_rules`.

## Deliverables

- `configs/ingestion/regulations/institutional_rules/retrieval-eval-manifest.v1.json`
  now contains 42校级 institutional regulation documents.
- `packages/evals/fixtures/institutional_rules_retrieval_qrels.json` now contains
  45 release-gate cases.
- `packages/evals/fixtures/institutional_rules_release_acceptance.v1.json` now
  contains 45 release acceptance cases.
- `packages/evals/fixtures/institutional_rules_golden_retrieval_qrels.v1.json`
  now contains 89 regression-locked cases: 84 positive cases and 5 hard-negative /
  no-hit guards.
- `packages/evals/fixtures/institutional_rules_answer_quality_cases.v1.json` now
  contains 42 institutional answer source-identity cases.
- `tests.evals.retrieval_benchmark_qrels_module_and_handbook_suite` now checks
  that the 12 re-admitted rules keep the semantic `version_id`s from Phase 42 v9
  `document-units.jsonl` chunk-preparation evidence.

## Boundary

- The 30 Phase 9 released documents keep their existing `document_id` and
  `version_id`.
- The 12 re-admitted documents use regenerated
  `regulations/institutional_rules` document ids, while their `version_id` and
  `semantic_content_hash` stay aligned to the already validated Phase 42 v9
  chunk-preparation evidence.
- `中央民族大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法` remains excluded as
  an annual/cohort-specific scoped rule.
- This phase does not claim a fresh live alias publish, embedding run or live
  retrieval run for the expanded 42-document set.

## Evidence

- `../../evidence/phase-11-selected-school-level-regulation-admission/selected-school-level-regulation-admission.report.json`

