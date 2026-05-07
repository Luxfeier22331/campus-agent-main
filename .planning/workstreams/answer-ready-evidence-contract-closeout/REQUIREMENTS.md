---
doc_type: requirements
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Requirements: Answer-Ready Evidence Contract Closeout

## Goal

Close the structural debt where answer-ready evidence semantics are partially produced at ingestion
time but not carried as a stable retrieval/answer contract through indexing, ranking, evidence
selection, synthesis and eval.

## Problem Statement

Current state is partially complete:

- ingestion emits `answer_role` and folds many cases into `semantic_role / claim_type / polarity`
- retrieval contract exposes `semantic_role / polarity / action_type / claim_type / article_no /
  clause_no / section_kind`
- runtime ranking now has a local typed query intent model

Remaining gap:

- `answer_role` is not retrieval-facing
- `condition_subject` is missing
- procedure step is not typed beyond `procedure_step`
- eligibility intro is not typed enough to distinguish non-answer-bearing intro from answerable
  condition groups
- category overview is generated but not modeled as a typed evidence contract
- parent-child clause context is still too implicit
- eval mostly detects final failure rather than stage-local contract failure

## In Scope

- `regulations/student_rules` as first implementation target.
- Shared regulation evidence model reusable by `institutional_rules` where compatible; this
  workstream's mandatory closeout target is `student_rules`, while `institutional_rules` requires an
  explicit adoption decision or follow-up seed unless Phase 0 promotes it to a blocker.
- Ingestion semantic extraction and chunk metadata.
- Chunk quality gate and release admission checks for answer-ready fields.
- Qdrant payload metadata and retrieval projection.
- `EvidenceSource` minimal online fields only when Phase 0 proves public response consumption needs
  them; otherwise equivalent retrieval-internal projection fields are still mandatory for online
  ranking, selection and typed draft support.
- Retrieval-internal typed evidence attributes for richer structures.
- Intent-aware ranking and supporting evidence selection.
- Typed answer draft inputs for list, procedure, eligibility judgment and condition-table answers.
- Component-level eval that separates intent, retrieval, ranking, selection, synthesis and grounding.

## Out Of Scope

- New public product surface.
- New query-enabled collection.
- Open-domain web retrieval.
- Freshness/live/latest branch changes.
- Supervisor routing or ToolSpec expansion.
- Replacing the completed RAG internal Agents SDK loop.
- Making `packages/contracts` carry provider/backend-specific payload shapes.
- Full historical backfill for every regulation document before first contract is proven on
  `student_rules`.

## Success Criteria

- `student_rules` chunk/release gate fails closed when required answer-ready fields are missing for
  query-serving chunks.
- Retrieval projection must preserve the following fields either on public `EvidenceSource` or on a
  retrieval-internal typed evidence projection that is available to ranking, selection and typed
  draft construction:
  - `answer_role`
  - `condition_subject`
  - `parent_unit_id` or equivalent parent context id
  - `evidence_contract_version`
  - existing `semantic_role / claim_type / polarity / action_type / article_no / clause_no /
    section_kind`
- Typed procedure metadata is available for procedure chunks:
  - `procedure_step_index`
  - `procedure_actor`
  - `procedure_action`
  - optional `procedure_materials`
  - optional `procedure_next_actor`
- Category overview chunks carry typed category metadata:
  - `category_id`
  - `audience`
  - `member_policy_document_ids`
  - `member_policy_titles`
- Eligibility and condition chunks carry typed subject metadata where possible:
  - `condition_subject`
  - `condition_polarity`
  - `condition_group_id` when the condition belongs to a group
- Ranking and evidence selection use typed metadata as the primary signal.
- Runtime text cues remain only as compatibility fallback for old indexes or explicitly absent
  metadata. Rebuilt query-serving `student_rules` chunks must not rely on text cues as the primary
  answer-ready signal, and fallback usage must be surfaced in diagnostics/eval with a measurable
  budget defined in Phase 0.
- Component eval can fail a case specifically as `intent_mismatch`, `retrieval_miss`,
  `ranking_mismatch`, `selection_not_answer_ready`, `draft_contract_mismatch`,
  `grounding_mismatch` or `chunk_contract_missing`.
- Regression cases cover:
  - `处分怎么消`
  - `哪些情况不能解除处分`
  - `成绩没前十还能评国奖吗`
  - `论文能不能算国奖条件`
  - `本科生有哪些奖学金能申请`
  - `奖学金怎么申请`

## Design Principles

- Metadata starts at ingestion; runtime should not infer stable evidence semantics from raw Chinese
  snippets unless metadata is absent.
- Retrieval first-stage remains recall-oriented; metadata-aware ranking and selection provide
  precision.
- Public contract promotion must be minimal and justified by online consumption needs.
- Complex extraction shapes can remain retrieval-internal until a public response surface needs them.
- Release gates and eval must prevent silent regression back to rule-driven snippet parsing.
- Release-admission integration must use a real repo-owned gate path and command; adding a standalone
  eval that is not consumed by regulation release admission is not sufficient.
