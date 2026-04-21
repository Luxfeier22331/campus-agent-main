---
phase: "5"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 5 Research

## Purpose

把 `Phase 5: Adoption And Verification` 建立在两类事实之上：

- 前四个 phase 已经冻结的 modeling truth
- repo 当前真实存在的 related workstream / backlog / non-goal 边界

## Repo Pattern Readings

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/PLAN.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/REQUIREMENTS.md`
- `docs/plans/archive/historical/official-web-source-channel-news-opening.md`
- `.planning/WORKSTREAMS.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `docs/decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`

## Findings

### 1. exemplar 已经足够验证这条 workstream 的核心目标

- REQUIREMENTS 明确要求：
  - 至少有一条 worked example，证明同一条 notice 能同时产生 `notice_window` 与 `annual_cycle_rule` 候选而不混淆。
- `Phase 3-4` 已经把这两类 unit 的 authority / handoff state 写清。
- 因此 `Phase 5` 不需要再找更多样本才能完成 planning closeout；关键是把 exemplar 的 current-state / future-state route 显式写出来。

### 2. regulation / scoped-rule adoption 已经有明确的 deferred target workstream

- `authenticated-notice -> regulation downstream consumption` 已是 repo 级 deferred workstream。
- 它已经覆盖：
  - `regulations/institutional_regulations`
  - `regulations/scoped_rules`
  的 target-side hardening。
- 因此 notice consumption layer 不需要再承担 regulation target implementation；只要把 `attachment_rule_body`、`annual_cycle_rule`、`time_bound_operational_rule` 的 adoption route 写回这条 workstream 即可。

### 3. public publication/news adoption 已经有 backlog target，但 internal lecture/roster 没有

- backlog `official-web source channel / news opening` 已经是 public official-web 新闻/公告 opening 的正式入口。
- 但 ADR-0032 已明确：
  - `internal_notice_restricted` 的 `lecture_publicity`
  - `internal_notice_restricted` 的 `roster_publication`
  不属于当前产品消费目标。
- 因此 `Phase 5` 必须显式区分：
  - public-source publication/news candidate
  - internal restricted lecture/roster no-adoption case

### 4. `service_status_override` 目前只有 runtime family truth，没有 native adoption workstream

- completed `campus services / notices runtime admission` 只冻结了 runtime family/tool/seam。
- 目前 `.planning/WORKSTREAMS.md` 里没有独立 active/deferred native workstream 来承接 notice-derived `service_status_override` projection adoption。
- 所以这类 unit 当前只能：
  - 保留 handoff truth
  - 等 future workstream 被显式 admission

### 5. `attachment_form_template` 更接近 future document-center / restricted rollout，而不是 rag/service

- 它不是稳定制度正文，也不是 service current-effective override。
- 当前 workstream registry 里最近的 related lane 是：
  - deferred `restricted document rollout / verification`
- 因此最稳的 adoption truth 是：
  - 先保持 notice/runtime lane
  - future 若 document-center / restricted asset surface 真正 admission，再把它路由过去

## Phase-5 Decisions To Freeze

1. exemplar current-state / future-state routing 都要显式写出。
2. regulation/scoped-rule roles 回流到 deferred `authenticated-notice-regulation-consumption`。
3. public-source publication/news candidate 回流到 backlog `official-web-source-channel-news-opening`。
4. `service_status_override` 与 `attachment_form_template` 当前只冻结 adoption direction，不伪造不存在的 native workstream。
5. internal restricted `lecture_activity` / `roster_publication` 明确列为 no-adoption case。

## Deferrals

- real implementation
- future native workstream admission for service/document-center adoption
- archive / completed-state migration

## Risks If Mis-Scoped

- 如果不把 exemplar 写成 current-state / future-state 双路由，`body_only_answerable` 与 future complete adoption 的区别会重新模糊。
- 如果把 internal restricted lecture/roster 也路由到 news/publication surface，会直接违反 ADR-0032。
- 如果为 `service_status_override` / `attachment_form_template` 编造不存在的 active workstream，planning registry 会失真。

## Conclusions For Phase 5

1. 这一步的核心不是再发明边界，而是把前四个 phase 的结论路由回 repo 当前真实存在的 workstream landscape。
2. exemplar 已足够完成 worked example closeout。
3. 这条 workstream 之后应停止继续讨论基础 modeling，转去对应 adoption target 执行。
