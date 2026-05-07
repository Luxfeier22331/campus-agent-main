---
doc_type: state
status: active
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# State: Answer-Ready Semantic Extraction Rearchitecture

## Current Position

**Status:** active
**Current Phase:** Phase 5 - Answer-Ready Quality Gates
**Last Activity:** 2026-05-07
**Last Activity Description:** Phase 5 advanced again: release chunk quality summary continues to
emit machine-readable `answer_ready_contract_version`, `answer_ready_required_field_failures`,
`answer_ready_semantic_failures`, and `fallback_budget_status`; regulation release admission
manifest carries those answer-ready gate fields plus `semantic_oracle_status`; and the shared v3
validator now fail-closes multiple query-independent semantic consistency rules:
`answer_ready_polarity_role_conflict`, `answer_ready_intro_answer_bearing_conflict`,
`answer_ready_condition_subject_role_conflict`, and
`answer_ready_procedure_action_role_conflict`. Phase 3/4 structural work remains in place,
including stable `clause_unit_id` propagation and fail-closed validation for clause-labeled
answer-ready chunks missing child-unit identity.

## Current Slice

Phase 1 is complete. Phase 2 owner normalization is materially advanced, Phase 3 parent-child unit
work is partially landed, Phase 4 extraction production remains active, and Phase 5 gate output
hardening has now started:

- shared registry/taxonomy owner is established under `packages/shared`
- `student_rules` discovery/category registry no longer lives canonically in `ingestion-core`
- multi-category overview emission works for documents like
  `handbook:e90f9707387f9e232ea88ce1c7f5328242e52389`
- shared semantic resolution now canonicalizes explicit legacy aliases such as
  `general_eligibility -> generic_condition`
- procedure-step contract production now honors metadata-first action assignment before text-cue
  fallback
- retrieval chunk quality gate now treats missing `procedure_action_provenance` as part of grouped
  procedure contract failure reporting
- answer-ready evidence now carries `clause_unit_id` when a stable child-clause identity can be
  derived, and retrieval internal attributes preserve it
- shared v3 validation now fails clause-labeled answer-ready chunks that still lack
  `clause_unit_id`
- repeated eligibility-group intros under the same parent article now produce distinct stable
  `condition_group_id` values such as `article-020:group-01:rank_threshold` and
  `article-020:group-02:rank_threshold`
- release chunk quality summary now emits structured answer-ready gate evidence:
  `answer_ready_contract_version`, `answer_ready_required_field_failures`,
  `answer_ready_semantic_failures`, `fallback_budget_status`
- regulation release admission manifest now carries answer-ready gate evidence forward for Phase
  9/10 audit paths, including `semantic_oracle_status`
- shared v3 validation now rejects a first class of query-independent semantic contradictions:
  answer-role/polarity mismatches
- shared v3 validation now also rejects:
  - `eligibility_intro` chunks incorrectly marked as final answer-bearing evidence
  - `condition_subject` values whose registry-declared allowed `answer_role` set does not include
    the emitted answer role
  - `procedure_action` values whose registry-declared allowed `answer_role` set does not include
    the emitted answer role
- regulation chunking now handles a previously uncovered Phase 3 case:
  single enumerated clauses with inline example tails such as
  `且在学术研究上取得显著成绩` are split into parent-preserving child units instead of being emitted
  as one degraded answer-ready chunk
- regulation chunking now also preserves answer-ready child-unit identity for single enumerated
  clauses that previously fell back as one chunk, including:
  - standalone eligibility clauses that now keep `clause_unit_id`
  - standalone procedure clauses under procedure section paths that now retain `procedure_step`
    typing instead of degrading to `eligibility_condition`
- regulation chunking now further splits inline example tails that themselves contain multiple
  example members, so one clause can emit `exception_rule + multiple example_evidence children`
  without collapsing multiple example facts back into one child unit
- regulation chunking now preserves shared scope semantics across sibling clause children instead
  of treating the intro prefix as a one-shot cue:
  - later atomic eligibility clauses under the same `符合下列条件之一` scope no longer drop to
    `supporting_detail`
  - exclusion-style list intros such as `有下列情形之一的，不予解除处分:` now retain clause-level
    child splitting and negative role inheritance for subsequent labeled clauses
  - terminal provisions like `本办法自公布之日起施行` remain protected from false scope promotion
- `institutional_rules` no longer relies only on single-clause compatibility proof for answer-ready
  procedure semantics:
  - the collection chunk strategy now routes `regulation_body` units through the same answer-ready
    regulation chunking path used by `student_rules`
  - official-web institutional procedure lists such as `申诉按如下程序办理` now emit typed
    clause-level `procedure_step` child chunks with stable step indexes and
    `application_procedure` grouping instead of collapsing into one undifferentiated chunk
- the Phase 0 oracle sample `学生证丢了怎么补` is now covered by closeout/component proof instead of
  living only in retrieval/golden-case fixtures:
  - typed `procedure_step` chunks for the student-card reissue flow are exercised through
    closeout audit
  - component eval now includes a dedicated positive procedure case for student-card reissue

Next across Phase 4/5:

- move remaining ingestion-private semantic cue chains behind shared, testable assignment owners
- replace still-heuristic condition-subject grouping lineage with full clause/parent-child
  structured grouping inputs beyond the currently fixed repeated-intro and `clause_unit_id` cases
- tighten remaining answer-ready clause splitting so child-unit identity is not weakened by
  multi-clause grouped segments; single-clause inline example tails and standalone single-clause
  answer-ready units are now preserved, multi-member inline example tails are now split, and
  shared-scope sibling atomic clause inheritance is now fixed for both positive and negative list
  intros, but broader grouped-segment cleanup is still open
- add more static semantic consistency checks that are query-independent rather than only
  role/field presence checks; polarity-role conflict, intro answer-bearing conflict,
  condition-subject/role conflict, and procedure-action/role conflict are implemented, but
  broader role/provenance/grouping consistency is still open
- expand typed extraction beyond current procedure/condition slices to intro/table/category proof
  that is oracle-backed rather than fixture-only; `student_rules` and an early
  `institutional_rules` procedure-list denominator are now covered, but broader oracle-backed
  institutional category/deadline/material slices remain open

## Progress

**Phases Complete:** 2 / 12
**Current Plan:** `ROADMAP.md` plus phase-level `PLAN.md` files.

## Blockers

No external blocker. Remaining work is structural Phase 4 follow-through plus unresolved Phase 2/3
debt, not environment or runtime admission.

## Guardrails

- Do not reopen supervisor routing, SDK tool schema, public ToolSpec or freshness/live branches.
- Do not treat field presence as semantic correctness.
- Do not count old-index fallback as target completion.
- Do not claim production serving adoption without release manifest and alias evidence.
- Do not promote retrieval-internal metadata into `packages/contracts` unless public DTO consumption
  is explicitly proven.

## Session Continuity

Resume by opening:

1. `README.md`
1. `REQUIREMENTS.md`
1. `ROADMAP.md`
1. `phases/phase-01-contract-v3-and-schema-governance/SUMMARY.md`
1. `phases/phase-02-taxonomy-and-registry-normalization/PLAN.md`
1. `phases/phase-04-typed-semantic-extraction-pipeline/PLAN.md`
1. `packages/shared/src/campus_shared/regulation_semantic_registry.py`
1. `packages/ingestion-core/src/campus_ingestion_core/regulation_evidence_contract.py`
