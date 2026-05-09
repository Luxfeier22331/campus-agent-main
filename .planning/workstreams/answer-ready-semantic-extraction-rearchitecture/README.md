---
doc_type: index
status: completed
created: 2026-05-07
updated: 2026-05-09
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

- status: `completed`
- current phase: `completed`
- active implementation: none
- current slice: final closeout review repaired the last workstream-owned gaps in
  `regulation_chunking`, release-admission manifest immutability, and post-publish release
  auditing; regulation-family release/adoption evidence has been re-verified, and the workstream
  is now complete
- owner boundary: `packages/shared` + `packages/ingestion-core` + `packages/retrieval-core` +
  `packages/rag-agent` + `packages/evals` + regulation RAG release lane
- serving boundary: only current query-enabled regulation-family surfaces are mandatory:
  `regulations/student_rules` and `regulations/institutional_rules`

## Why This Exists

The completed `answer-ready-evidence-contract-closeout` proved that typed answer-ready fields can
flow through ingestion, retrieval, ranking, answer drafting and release gates. It did not prove a
fully debt-free target state.

Remaining structural debt:

- some shared semantic resolvers still retain centralized compatibility-oriented fallback branches,
  but target v3 serving and release admission now fail closed before generic retrieval fallback or
  generic placeholder procedure actor/action values can pass as target truth
- retrieval fallback exists for old-index compatibility and must be quarantined away from target v3
  completion
- component eval is now fixture-backed, stage-aware, can derive observations from real runtime
  responses plus retrieval fallback signals, and its deterministic JSON summary can now be attached
  to regulation release manifests, release reports, Qdrant release metadata and release-admission
  evidence; denominator expansion now also covers the frozen ambiguous scholarship clarification
  case, regulation-family unsupported/no-hit rows, and an explicit regulation-family `table_fact`
  row for scholarship amount/quota lookup
- final closeout review also resolved the last Phase 11 blind spots:
  - sampled published payload audit now revalidates both flat payload metadata and runtime-effective
    `_node_content` metadata
  - flat/runtime target-v3 projection drift on `answer_role` and
    `evidence_contract_version` now fails closeout audit
  - no remaining workstream-owned closeout gap is open

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
- target regulation query-serving retrieval now distinguishes explicit compatibility posture:
  `target_v3_only` fails closed on legacy primary fallback, while
  `legacy_old_index_compatibility` is compatibility-only and excluded from completion
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

The workstream-owned semantic, release and audit evidence now satisfies these gates, but the
explicit repo-owned `Verification Baseline` in `REQUIREMENTS.md` has been cleared. Planning truth therefore moves to `completed`.
