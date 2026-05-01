---
doc_type: roadmap
workstream: notice-agent-card-first-tool-boundary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Notice Agent Card-First Tool Boundary

## Workstream Objective

把 notice-agent / notice tool 从“可读取并输出正文的 provider tool”重切为
source-link / card-first 的通知能力边界。

目标实现不是删除正文采集，而是把正文、OCR、图片文字和附件正文固定在
source-truth / internal context / downstream materialization plane，默认用户面只返回
官方来源卡片、链接、短摘要或受控事实。

## Locked Cross-Phase Design

- `campus_notice_discover` 保留为 agent-facing tool，因为它表达“找通知”这个用户意图。
- `campus_notice_get` 不再作为 provider/SDK default pilot 或 body-serving tool。执行阶段可以选择硬切、改名或 demote，但最终状态必须是 selected notice resolve/context 作为 internal deterministic query function。
- `NoticeCardSet` / `ResolvedNoticeRef` / `NoticeContextProjection` / `display_policy` 是本 workstream 的核心目标词汇。
- public `answer_text`、workflow trace、panel canonical asset、eval canonical asset 不得携带 full `normalized_body`、OCR owner text、inline image text 或 attachment body。
- source-truth、PG read model、object storage、OCR/multimodal materialization 继续保留；本 workstream 不改 collector/ingestion owner。

## Phase Status

- [x] **Phase 0: Boundary Freeze And Inventory** — inventory current body-serving paths, freeze vocabulary, and record the `campus_notice_get` migration decision.
- [x] **Phase 1: Contract And ToolSpec Recut** — update notice contracts, ToolSpec registry posture, provider schema rules, and cross-language fixtures.
- [x] **Phase 2: Go Runtime And Finalizer Guard** — stop Go direct runtime/finalizer from emitting notice full body and add source-card rendering.
- [x] **Phase 3: Python Notice-Agent And SDK Recut** — refactor notice-agent adapter, provider tool loop, and SDK pilot away from body-serving notice get.
- [x] **Phase 4: Eval Denominator And Drift Guards** — add card-first behavior evals, body leak fixtures, and ToolSpec/provider/SDK drift guards.
- [x] **Phase 5: Downstream Workflow Integration** — wire bounded notice context into schedule/status/service-guide/RAG workflows without raw body handoff.
- [x] **Phase 6: Closeout Docs And Opening Review** — update final docs, freeze reopen rule, and decide card-first notice serving readiness.

## Dependency Graph

- Phase 0 blocks all implementation phases.
- Phase 1 must land before Phase 2 and Phase 3 because Go/Python behavior must consume the same contract and ToolSpec posture.
- Phase 2 and Phase 3 can run in parallel after Phase 1 if write sets are kept separate.
- Phase 4 depends on Phase 1-3 behavior and should be the first repo-wide regression gate.
- Phase 5 depends on the bounded context projection contract from Phase 1 and leak guards from Phase 2-4.
- Phase 6 depends on all implementation and verification artifacts.

## Phase 0: Boundary Freeze And Inventory

**Goal:** make the target boundary explicit before implementation.

**Primary artifact:** `BOUNDARY-INVENTORY.md`

**Deliverables:**

- Inventory of every current body-serving or body-carrying path.
- Frozen vocabulary and payload/result shape decisions.
- Final `campus_notice_get` posture decision:
  - hardcut from agent-facing ToolSpec,
  - demote to internal query function,
  - or replace with a card/context resolve function.
- Phase 1-5 file-impact map.

## Phase 1: Contract And ToolSpec Recut

**Goal:** make contracts express card-first runtime semantics.

**Primary artifact:** updated contract/model/ToolSpec shape.

**Deliverables:**

- Notice card/result contracts with explicit `display_policy`.
- Internal context projection contract that can carry bounded summaries/facts, hashes and source refs, not raw body.
- ToolSpec registry no longer exposes body/context functions as provider/SDK top-level tools.
- Contract tests and schema snapshots updated.

## Phase 2: Go Runtime And Finalizer Guard

**Goal:** prevent Go runtime paths from emitting full notice body.

**Primary artifact:** Go runtime source-card rendering and finalizer leak guard.

**Deliverables:**

- Structured direct notice answer returns title + official URL/card.
- `normalized_body`, OCR owner text and attachment body blocked from public finalization and workflow summary.
- Selected notice resolution reads only bounded card/context projections.
- Go tests cover direct text, planner, structured query, workflow trace and fail-close behavior.

## Phase 3: Python Notice-Agent And SDK Recut

**Goal:** align Python notice-agent and provider/SDK pilot with card-first semantics.

**Primary artifact:** notice-agent adapter and SDK/provider pilot no longer body-serving.

**Deliverables:**

- `packages/notice-agent` returns card/source-link answer text by default.
- Summary/fact extraction can consume internal bounded context only when explicitly requested.
- Provider function-call and Agents SDK pilot are recut to discover/card/resolve semantics or closed.
- Python tests update expected tool names, answer text, safe details and trace projections.

## Phase 4: Eval Denominator And Drift Guards

**Goal:** prove behavior and prevent regression.

**Primary artifact:** eval denominator and guardrail tests.

**Deliverables:**

- Evals for discover, original-link, selected-ref resolution, summary, fact extraction, current-fact reroute and restricted authz.
- Negative fixtures proving public answer and trace do not leak full body/OCR/attachment text.
- Source/contract guard rejects new top-level body-serving notice tools.
- Provider/SDK schema drift guard fails if body/context function re-enters the tool surface.

## Phase 5: Downstream Workflow Integration

**Goal:** preserve downstream consumption without exposing notice body to users.

**Primary artifact:** bounded notice context projection for multi-step workflows.

**Deliverables:**

- Schedule/status/service-guide/RAG workflows consume materialized read models first and notice context only as evidence or recent-change supplement.
- Multi-step trace carries source refs, hashes, card metadata, short summaries and extracted facts, not raw body.
- Current-fact questions reroute to dedicated structured runtime when available.

## Phase 6: Closeout Docs And Opening Review

**Goal:** close the workstream and decide next serving posture.

**Primary artifact:** closeout report and serving opening review.

**Deliverables:**

- Updated notice runtime contract and architecture docs.
- `campus_notice_get` replacement/demotion decision recorded as final posture.
- Reopen rule covers body-serving regression, ToolSpec drift, SDK/provider schema drift and unauthorized notice body exposure.
- Opening review separates card-first notice discovery readiness from downstream materialization readiness.
