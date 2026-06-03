---
doc_type: requirements
status: completed
created: 2026-05-07
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Requirements: Answer-Ready Semantic Extraction Rearchitecture

## Goal

彻底清理 regulation-family answer-ready evidence metadata 的结构债，让制度类 RAG 的语义证据从
ingestion 到 release、retrieval、answer draft、grounding、eval 形成无 fallback 债务的 v3 目标体系。

## Problem Statement

当前 v2 closeout 曾经补齐了关键字段和若干 gate，但长期目标仍未完全达到，因此本
workstream 已收口以下结构债：

- `condition_subject` 从 registry / taxonomy / structured unit 输入驱动，并携带 provenance
- `condition_group_id` 成为生产链路稳定语义分组来源
- `eligibility_intro` 成为 typed grouping contract，而不是只靠 answer-role 行为
- procedure step 的 actor / action / materials 抽取由 shared taxonomy/registry owner 承担
- category overview 覆盖制度类通用 registry categories
- chunk quality gate 增加 semantic correctness admission
- retrieval fallback 从目标 v3 rebuilt serving path 清零
- `institutional_rules` 具备和 `student_rules` 同等的 rebuilt release / serving adoption 证据

## In Scope

- Regulation-family reusable internal contract: `answer_ready_evidence.v3`.
- Mandatory serving targets:
  - `regulations/student_rules`
  - `regulations/institutional_rules`
- Shared contract package used by ingestion and retrieval where appropriate.
- Ingestion semantic extraction, taxonomy registry, chunk unit model and metadata production.
- Clause-level / parent-child chunking for regulation documents.
- Condition grouping, typed eligibility intro, typed procedure step and category overview metadata.
- Release admission, chunk quality gate and post-publish audit for query-enabled regulation scopes.
- Retrieval ranking, selection and replan consumption of typed metadata.
- `rag-agent` typed answer draft and grounding validation only as needed to consume v3 metadata.
- Component eval and release acceptance diagnostics.
- Legacy old-index compatibility quarantine and removal criteria.
- Phase 0 semantic oracle and release-lane command binding.
- Institutional-rule coverage from early contract/extraction phases, not only final rebuild.

## Out Of Scope

- Supervisor route changes.
- Public ToolSpec expansion.
- New product surface.
- New query-enabled collection.
- `regulations/scoped_rules` serving opening.
- Open-domain web retrieval.
- Freshness/live/latest behavior changes.
- Moving data-plane or retrieval-internal metadata into `packages/contracts` without public DTO need.
- Using runtime text-cue rules as target semantics.

## Success Criteria

- `answer_ready_evidence.v3` has a versioned schema with required fields by evidence role.
- All v3 answer-ready chunks carry metadata from structured extraction, taxonomy or registry inputs,
  not ad hoc runtime cue parsing.
- `condition_subject` is taxonomy-driven and carries source/provenance diagnostics.
- `condition_group_id` groups eligibility conditions, exceptions, exclusions, material requirements
  and procedure steps under stable parent units.
- typed eligibility intro includes:
  - `intro_scope`
  - `introduced_condition_group_id`
  - `intro_target_roles`
  - explicit non-answer-bearing status
- typed procedure step includes:
  - `procedure_step_index`
  - `procedure_actor`
  - `procedure_action`
  - optional `procedure_materials`
  - optional `procedure_next_actor`
  - action taxonomy version
- generalized category overview includes:
  - `category_id`
  - `audience`
  - `member_policy_document_ids`
  - `member_policy_titles`
  - registry version
- Clause-level / parent-child chunking preserves parent article context and avoids mixing intro,
  condition, example, exclusion and procedure content when that prevents answer-ready evidence use.
- Quality gates fail closed for missing required fields and for semantic contradictions such as
  positive-procedure queries selecting exclusion evidence.
- Retrieval ranking and evidence selection use typed metadata before consulting legacy signals.
- Target v3 `student_rules` and `institutional_rules` rebuilt releases have zero primary text-cue
  fallback in acceptance diagnostics.
- Component eval reports stage-local failures:
  - `intent_mismatch`
  - `retrieval_miss`
  - `ranking_mismatch`
  - `selection_not_answer_ready`
  - `semantic_contract_mismatch`
  - `draft_contract_mismatch`
  - `grounding_mismatch`
  - `release_contract_missing`
- Both mandatory scopes have release manifest and serving alias evidence for the v3 contract.
- Legacy signals are documented as old-index-only diagnostics and cannot satisfy target completion.
- A gold semantic oracle exists before implementation and maps each target sample to expected:
  - query intent
  - answer role
  - condition subject
  - polarity
  - condition group behavior
  - category coverage
  - draft kind
  - grounding requirement
- Static release gates validate document/chunk metadata correctness, while query-conditioned
  contradictions are tested in retrieval/component eval. Release admission must not depend on a
  particular user query to decide whether a chunk is internally valid.
- The release lane entrypoints and required output fields are frozen before Phase 9/10 execution.

## Negative Completion Criteria

The workstream would need to be reopened if any of these become true again:

- tests only prove field presence, not semantic correctness
- `student_rules` passes but `institutional_rules` remains only compatibility-tested
- runtime text cues are still the primary ranking or evidence-selection signal for rebuilt v3 chunks
- release admission can publish a query-enabled regulation scope with missing v3 required metadata
- a compatibility shim is introduced without an old-index-only quarantine and removal rule
- component eval cannot say whether failure came from extraction, retrieval, ranking, selection,
  draft, grounding or release admission
- Phase 9/10 release commands regress to placeholder commands or unspecified artifact names
- taxonomy/category/action values can be added without admission rules, alias review and release
  invalidation policy

## Verification Baseline

Default verification remains repo-owned commands:

```bash
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
uv run --all-packages python -m unittest discover -s tests -t .
pnpm docs:lint
pnpm yaml:lint
pnpm decomposition:lint
```

Phase-local plans may add narrower commands, but completion must record real command output in phase
summaries.
