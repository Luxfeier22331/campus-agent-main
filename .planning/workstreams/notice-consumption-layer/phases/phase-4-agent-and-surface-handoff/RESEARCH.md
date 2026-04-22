---
phase: "4"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 4 Research

## Purpose

把 `Phase 4: Agent And Surface Handoff` 建立在三类既有真相之上：

- `Phase 2-3` 已冻结的 `default_agent` / `target_surface` / owner / completeness / answerability contract
- 已完成的 `campus-services / notices runtime admission` workstream 对 runtime family、tool、handoff seam 的冻结
- 现有 `regulations/*` / service runtime / notice runtime 的 target-surface boundary

## Repo Pattern Readings

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/PLAN.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/CONTEXT.md`
- `packages/notice-agent/README.md`
- `packages/supervisor-core/README.md`

## Findings

### 1. `default_agent` / `target_surface` 只能消费已冻结的 runtime seam，不能重开 runtime admission

- runtime admission workstream已经完成，`notice-agent`、`campus-services-agent`、`rag-agent` 的 owner / tool / wiring truth 已冻结。
- 因此 `Phase 4` 的正确动作不是再讨论“tool 属于谁”，而是把 `Phase 3` 的 unit state 映射到这些既有 seam。

### 2. 所有显式 notice task 仍然必须先落到 `notice-agent`

- `notice-agent` 的 canonical 职责仍是：
  - `campus_notice_discover`
  - `campus_notice_get`
- `official_web` serving strategy 也已明确：
  - public notice runtime 与 `fresh_news` retrieval 并存
  - 用户 intent 是“找 notice/打开 notice”时，应先走 notice runtime
- 因此即使某个 unit 将来可进入 `rag-agent` 或 `campus-services-agent`，它的显式 notice-task entry 也不能被直接抢走。

### 3. `rag-agent` 与 `campus-services-agent` 都不能直接消费 raw notice

- execution / retrieval architecture 已冻结：
  - `rag-agent` 承接 retrieval-oriented stable knowledge
  - `campus-services-agent` 承接 projection-backed structured service truth
  - 二者都不能把 notice source bundle 当 query seam
- 这意味着 handoff 的真正含义是：
  - 先从 notice consumption layer 判断 unit 是否具备进入下游 semantic-owner projection 的资格
  - 再由 future projection / collection / runtime 消费
  不是让别的 agent 直接拿 `campus_notice_get` 正文顶替自己的 owner truth

### 4. `body_only_answerable` 不足以支撑下游 semantic-owner handoff

- `Phase 3` 已冻结：
  - `body_only_answerable` 只允许 bounded notice-runtime explanation
- `annual_cycle_rule` / `time_bound_operational_rule` 的 future query contract 也要求显式 metadata / filter / temporal policy
- 因此 `body_only_answerable` 不能成为 `rag-agent` / `campus-services-agent` 的 adoption ticket。

### 5. `regulations/institutional_rules` 与 `regulations/scoped_rules` 的 target-surface split 已有明确真相

- `ADR-0036` 已明确：
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
  不进入 `regulations/institutional_rules`
- `ADR-0037` 已明确：
  - 这两类文档的 holding target 是 `regulations/scoped_rules`
  - 该 surface 当前仍是 `offline_preparation + query_disabled`
- 因此 `Phase 4` 可以直接冻结：
  - stable formal rule body -> future `rag-agent` + `regulations/institutional_rules`
  - annual/time-bound scoped rule body -> future `rag-agent` + `regulations/scoped_rules`

### 6. `service_status_runtime` 需要比“看起来像运营通知”更强的 handoff 条件

- `campus-services-agent` 只消费 current-effective structured service truth。
- `service_status_lookup` 也不是 generic RAG 或 raw notice alias。
- 因此只有真正完成：
  - service-domain normalization
  - current-effective / override 收口
  的 unit，才有资格 handoff 到 `service_status_runtime`。
- 这说明：
  - `service_status_override` 可以成为明确 candidate
  - `time_bound_operational_rule` 只有在额外 service-shaped projection 成立后才可能 handoff；否则继续留在 notice/runtime or scoped-rule lane

### 7. `publication_surface_candidate` 现在只是 future public-source target hint

- 当前 repo 并没有 dedicated publication runtime。
- 对 public source，`lecture_activity` 一类 unit 虽然不适合 generic RAG owner truth，但也没有单独 product entry。
- 对 `internal_notice_restricted`，ADR-0032 已明确：
  - `lecture_publicity`
  - `roster_publication`
  不属于当前产品消费目标。
- 因此最稳的 freeze 是：
  - public-source publication-like unit 可保留 `target_surface=publication_surface_candidate`
  - `default_agent` 继续保持 `notice-agent`
  - restricted internal `lecture_activity` / `roster_publication` 不被写成当前产品 adoption candidate

### 8. restricted 与 public source family 共享 semantic handoff contract，但不共享 opening posture

- `Phase 1` 已冻结：
  - `official_web_public_notice`
  - `internal_notice_restricted`
  共享 notice consumption model
- runtime admission workstream 也已冻结：
  - public / restricted notice projection 必须分 source family
- 因此 `Phase 4` 需要明确：
  - 同一 role 可以拥有同样的 future target hint
  - 但 restricted runtime/query 是否可用仍需单独 admission，不能被 target hint 偷换

## Phase-4 Decisions To Freeze

1. `notice_runtime` 是所有 notice-derived unit 的默认 holding surface。
2. 显式 notice task 的第一入口始终是 `notice-agent`。
3. 只有 `complete + answerable` units 才有资格成为 future `rag-agent` / `campus-services-agent` candidate。
4. `body_only_answerable` / `manual_review_required` / `reference_only` / `not_answerable` 都不得 handoff 给下游 semantic-owner agent。
5. `annual_cycle_rule` / `time_bound_operational_rule` 的 canonical future target 是 `regulations/scoped_rules`，不是 `institutional_rules`。
6. `service_status_runtime` 只接已经 service-shaped 的 current-effective override truth。
7. `publication_surface_candidate` 在 dedicated runtime 缺席时，默认继续由 `notice-agent` 承接；internal restricted `lecture_activity` / `roster_publication` 不进入当前产品 adoption。
8. restricted source family 的 runtime opening 继续独立受 gate 约束。

## Deferrals

- `Phase 5`
  - exemplar walkthrough
  - adoption routing
  - verification closeout
- future implementation
  - real projection / query service
  - publication runtime admission
  - restricted runtime opening

## Risks If Mis-Scoped

- 如果把 `default_agent` / `target_surface` 重新写成 runtime admission 事实，会和已完成的 runtime-admission workstream 冲突。
- 如果允许 `body_only_answerable` 直接 handoff 到 `rag-agent` / `campus-services-agent`，wrapper notice 会重新污染 semantic-owner surface。
- 如果不区分 `regulations/institutional_rules` 与 `regulations/scoped_rules`，`annual_cycle_rule` / `time_bound_operational_rule` 的边界会再次回退。
- 如果把 `publication_surface_candidate` 误写成已开放 surface，会提前制造不存在的产品入口。

## Conclusions For Phase 4

1. 这一步的核心是冻结 handoff gate，而不是新增 agent。
2. `notice-agent` 继续是 notice-derived unit 的默认 runtime holding owner。
3. future `rag-agent` / `campus-services-agent` 只接 `complete + answerable` 的下游 semantic-owner projection candidate。
4. `Phase 5` 可以直接基于这套 handoff truth 做 worked example 和 adoption 路由。
