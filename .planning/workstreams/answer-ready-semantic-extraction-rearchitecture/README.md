---
doc_type: index
status: active
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Workstream: Answer-Ready Semantic Extraction Rearchitecture

这是 `answer-ready-semantic-extraction-rearchitecture` 的 native workstream 入口。

本 workstream 负责把 regulation-family RAG 的 answer-ready evidence metadata 从“字段补齐 +
局部规则修补”提升为完整、可验证、可发布的语义抽取与检索消费体系。它不是继续补
`answer-ready-evidence-contract-closeout` 的尾巴，而是独立收口长期债务：contract 版本、taxonomy
治理、clause / parent-child chunking、typed extraction、release gate、retrieval fallback 清零、
typed answer grounding、组件级 eval，以及 `student_rules` / `institutional_rules` 的真实重建发布证据。

## Current Status

- status: `active`
- current phase: `Phase 2 - Taxonomy And Registry Normalization`
- active implementation: Phase 1 contract/schema governance is complete and verified; Phase 2 is
  the current build slice
- current slice: normalize `condition_subject`, `procedure_action` and `category_id` into shared
  taxonomy/registry records with admission/version governance, and remove private per-module
  canonical-value drift
- owner boundary: `packages/shared` + `packages/ingestion-core` + `packages/retrieval-core` +
  `packages/rag-agent` + `packages/evals` + regulation RAG release lane
- serving boundary: only current query-enabled regulation-family surfaces are mandatory:
  `regulations/student_rules` and `regulations/institutional_rules`

## Why This Exists

The completed `answer-ready-evidence-contract-closeout` proved that typed answer-ready fields can
flow through ingestion, retrieval, ranking, answer drafting and release gates. It did not prove a
fully debt-free target state.

Remaining structural debt:

- some fields still have heuristic extraction lineage
- condition grouping is not yet a first-class canonical unit
- typed eligibility intro exists only as answer-role behavior, not as a grouping contract
- procedure step extraction still mixes action semantics with text cues
- category overview is proven mainly by scholarship-style registry paths
- quality gates still emphasize defect detection more than semantic correctness admission
- rebuilt serving truth for both default regulation surfaces is not yet proven by release manifests
- retrieval fallback exists for old-index compatibility and must be quarantined away from target v3
  completion

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap ledger: `./GAP-LEDGER.md`
- phase plans: `./phases/*/PLAN.md`
- Phase 0 froze:
  - `./phases/phase-00-scope-inventory-and-done-definition-freeze/SEMANTIC-ORACLE.md`
  - `./phases/phase-00-scope-inventory-and-done-definition-freeze/RELEASE-LANE-ENTRYPOINTS.md`
  - `./phases/phase-00-scope-inventory-and-done-definition-freeze/TAXONOMY-ADMISSION.md`
  - `./phases/phase-00-scope-inventory-and-done-definition-freeze/INSTITUTIONAL-DENOMINATOR.md`
  - `./phases/phase-00-scope-inventory-and-done-definition-freeze/STATIC-VS-QUERY-GATES.md`

## Relation To Completed Closeout

`answer-ready-evidence-contract-closeout` is considered a completed v2 closeout.

This workstream starts from that result but uses stricter completion rules:

- field presence is not enough; semantic correctness must be measured
- `student_rules` and `institutional_rules` must both produce release-lane evidence
- runtime text-cue fallback is forbidden for target rebuilt v3 serving chunks
- compatibility support is allowed only inside a named legacy old-index lane
- no new public ToolSpec, supervisor routing or product surface is opened

## Boundary Notes

- Evidence metadata remains an internal retrieval/data-plane contract unless a public response field
  is explicitly justified.
- Do not put Qdrant, MinIO, model, SDK or provider-specific types into `packages/contracts`.
- Do not mix online retrieval planning state into canonical source truth.
- Do not make `rag-agent` own ingestion truth.
- Do not reopen freshness/live/latest behavior.
- Do not make `regulations/scoped_rules` query-enabled.
- Do not use one-off Chinese cue patches as the target fix.

## Completion Rule

This workstream can close only when:

- `answer_ready_evidence.v3` is frozen with versioned schema, taxonomy governance and migration rules
- ingestion produces stable typed metadata from structured units, registries and taxonomy records
- `condition_group_id`, typed eligibility intro, typed procedure step and generalized category
  overview are first-class contracts
- clause-level / parent-child units are preserved through chunking, payload and retrieval projection
- quality gates fail closed on missing or semantically wrong required metadata
- retrieval ranking, selection and replan consume typed metadata as the primary path
- target rebuilt regulation-family chunks have zero primary text-cue fallback
- typed answer drafts and claim grounding remain the single answer support path
- component eval can attribute failures by stage and semantic field
- both `regulations/student_rules` and `regulations/institutional_rules` have release manifest,
  retrieval acceptance, alias publish or explicit alias adoption evidence for the v3 contract
- legacy compatibility is quarantined and documented as old-index-only, not target behavior
- Phase 0 semantic oracle and release-lane entrypoints are complete enough that later phases cannot
  reinterpret "semantic correctness" or "serving adoption" after the fact
