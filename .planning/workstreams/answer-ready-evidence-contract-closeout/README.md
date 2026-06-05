---
doc_type: index
status: completed
created: 2026-05-06
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Workstream: Answer-Ready Evidence Contract Closeout

这是 `answer-ready-evidence-contract-closeout` 的 native workstream 入口。

本 workstream 负责清理制度类 RAG 中 answer-ready evidence metadata 未闭合的问题：ingestion
已经能产出部分 `answer_role / semantic_role / claim_type / polarity / section_kind /
article_no / clause_no`，但 retrieval-facing contract、payload、ranking、selection、typed
answer draft 与 eval gate 尚未形成稳定闭环。

## Current Status

- status: `completed`
- current phase: `Phase 6 completed`
- active implementation: none
- current slice: Phase 6 closeout completed in current worktree; answer-ready contract metadata,
  ranking/selection consumption, component eval, release fail-close gates and closeout audit are
  verified for target `student_rules` cases
- owner boundary: `packages/ingestion-core` + `packages/retrieval-core` + `packages/rag-agent` +
  `packages/evals`
- contract boundary: only online necessary retrieval fields may be promoted into
  `packages/contracts`; typed extraction internals remain package-local unless required by
  public `EvidenceSource` consumption

## Why This Exists

Recent RAG quality work exposed a recurring structural defect:

- query intent can ask for procedure, restriction, eligibility judgment or category discovery
- retrieved chunks can contain positive procedure, negative exclusion, intro, example, table fact or
  category overview
- current runtime still relies on a mix of folded metadata and Chinese cue rules to align them

This causes repeated localized fixes, for example:

- `处分怎么消` selecting negative restriction evidence when the user asks for a positive procedure
- `成绩没前十还能评国奖吗` over-constraining focus terms
- `有哪些奖学金` needing category overview evidence rather than one answer-bearing clause

The long-term fix is not another rule in `rag-agent`; it is an answer-ready evidence contract that
starts at ingestion, survives Qdrant payload and retrieval projection, and is consumed by ranking,
selection, synthesis and eval.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`
- execution order: all planned phases completed
- Phase 0 decision artifacts:
  - `./phases/phase-0-contract-inventory-and-boundary-freeze/FIELD-MATRIX.md`
  - `./phases/phase-0-contract-inventory-and-boundary-freeze/CONTRACT-DECISION.md`
  - `./phases/phase-0-contract-inventory-and-boundary-freeze/FALLBACK-DEPRECATION.md`
  - `./phases/phase-0-contract-inventory-and-boundary-freeze/RELEASE-GATE-DECISION.md`
  - `./phases/phase-0-contract-inventory-and-boundary-freeze/EVAL-CONTRACT.md`
  - `./phases/phase-0-contract-inventory-and-boundary-freeze/TAXONOMY-GOVERNANCE.md`
  - `./phases/phase-0-contract-inventory-and-boundary-freeze/PARENT-UNIT-ID.md`

## Boundary Notes

- Does not reopen supervisor routing, app-api product surfaces, Agents SDK loop, or public ToolSpec.
- Existing `rag-agent` SDK and deterministic output paths may receive answer-draft validation guards,
  but this workstream must not change SDK loop ownership, SDK tool schema, handoff routing or public
  ToolSpec.
- Does not open new query-enabled collections.
- Does not change freshness/live/latest posture.
- Does not make `rag-agent` own ingestion truth.
- Does not leak Qdrant, MinIO, tokenizer, SDK or provider-specific types into `packages/contracts`.
- Does not use runtime cue patches as the primary fix when the evidence contract is missing.
- Keeps `retrieval-core` as ranking/execution owner and `rag-agent` as synthesis/grounding owner.

## Related Workstreams

- Completed `agentic-rag-runtime-rearchitecture` made RAG planner/evidence/synthesis stages explicit.
- Completed `canonical-retrieval-quality-ops-hardening` added qrels, observation and reranker gates.
- Completed `rag-agent-internal-agents-sdk-loop` added internal SDK runtime, but explicitly excludes
  canonical/chunk/retrieval release quality.
- This workstream fills the evidence contract gap beneath those layers.

## Reopen / Completion Rule

This workstream can close only when:

- `EvidenceSource` or retrieval-internal projection carries the minimum answer-ready fields needed by
  ranking and answer synthesis; Phase 0 may choose public versus internal ownership, but may not
  remove the required online projection path.
- Student rules ingestion emits stable typed metadata for condition subjects, procedure steps,
  eligibility intros, category overviews and parent-child clause context.
- Qdrant payload/retrieval projection preserves those fields.
- Ranking/selection consumes typed evidence metadata before falling back to text cues.
- Text-cue signals are observable legacy diagnostics, quarantined from rebuilt query-serving chunks
  covered by the answer-ready contract, and cannot satisfy target completion.
- Component-level eval can attribute failures to intent, retrieval, ranking, selection, synthesis or
  grounding.
- Release/chunk quality gates fail closed when answer-ready contract fields are missing for
  query-enabled regulation scopes through the existing regulation release admission path.

Closeout evidence is recorded in `./GAP-LEDGER.md` and
`./phases/phase-6-backfill-migration-and-closeout/SUMMARY.md`.
