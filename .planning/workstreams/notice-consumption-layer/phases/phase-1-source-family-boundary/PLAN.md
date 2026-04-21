---
doc_type: phase_plan
phase: "1"
phase_name: "Source Family Boundary"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Plan

## Objective

冻结 `notice consumption layer` 的第一层边界真相，让后续 phase 不再重复争论“public notice 是否等于 news”“restricted notice 是否已经可查”“一条 notice 到底是 source truth 还是消费单元”，并为 `Phase 2` schema 与 `Phase 3` authority/completeness 留出清晰 handoff。

## Why This Phase Exists

当前 repo 已经有：

- `NoticeSourceFamily` 的 shared contract 闭集
- `official_web/fresh_news` 与 structured notice runtime 的分层约束
- `internal_notice` restricted / `offline_preparation` posture
- authenticated notice source-truth contract 对 canonical `notice` upstream 的冻结

当前 repo 还没有：

- `source_notice`、`notice_attachment`、`derived consumption unit` 的 phase-local 边界冻结
- `official_web_public_notice` 与 `internal_notice_restricted` 的消费边界文稿
- “public notice subset” 与 “freshness-sensitive news retrieval” 的正式 planning split
- role taxonomy 在 `Phase 1` 应冻结到什么程度、哪些必须留给 `Phase 2-3` 的正式收口

如果不先做这一步，后续 phase 会持续摇摆：

- `fresh_news` 会不会被误当作 public notice runtime
- `internal_notice_restricted` 会不会被误写成当前可查的 runtime 面
- `derived consumption unit` 会不会反向吞掉 canonical `source_notice`
- `notice_window`、`annual_cycle_rule`、`roster_publication`、`lecture_activity` 会不会继续混成一个大而模糊的 notice 对象

## Locked Inputs

- `NoticeSourceFamily` 继续保持闭集：
  - `official_web_public_notice`
  - `internal_notice_restricted`
- `official_web/fresh_news` 继续不是默认 opened query surface。
- `campus_notices/internal_notice` 继续保持 restricted、`offline_preparation`、`query_enabled_by_default=false`。
- `source_notice` 继续是 canonical upstream unit；query/runtime 不得回扫 raw/source bundle。
- 本 phase 不改写 runtime admission workstream，不实现新的 tool / adapter / query service。

## Decisions To Freeze

1. notice consumption layer 固定采用三层模型：
   - `source_notice`
   - `notice_attachment`
   - `derived consumption unit`
2. `source_notice` 是 canonical upstream，不被 discovery card、canonical body projection、retrieval document 或 derived unit 取代。
3. `notice_attachment` 继续保存 source-level relation truth；是否成为可消费正文，留到后续 authority/completeness phase 决定。
4. `derived consumption unit` 是 source-notice-backed typed projection；一条 `source_notice` 允许 fan-out 到多个 units，但每个 unit 只能有一个 `primary_role`。
5. `official_web_public_notice` 表示“适合进入 notice task routing 的 public notice-like page family”：
   - 它不是整个 `official_web`
   - 它不是整个 `fresh_news`
   - 它与 `fresh_news` 可以共享 source channel，但不能共享 serving/runtime posture
6. `internal_notice_restricted` 表示 restricted internal notice source family：
   - 当前只冻结它如何进入 consumption model
   - 不打开 query-serving
   - future runtime 仍只能消费 projected metadata / canonical body truth
7. `Phase 1` 只冻结 role taxonomy 的 boundary 与 admissible examples，不冻结正式字段 schema：
   - admissible examples:
     - `notice_window`
     - `annual_cycle_rule`
     - `time_bound_operational_rule`
     - `roster_publication`
     - `lecture_activity`
     - `service_status_override`
     - `attachment_rule_body`
     - `attachment_form_template`
8. authority / completeness 问题必须显式后送 `Phase 3`，不允许在 `Phase 1` 被静默吸收。

## Execution Slices

### Slice 1: Freeze Canonical Layering

- 在 phase-local docs 中明确三层模型各自的 owner：
  - `source_notice` = canonical upstream truth
  - `notice_attachment` = relation truth
  - `derived consumption unit` = typed consumption projection
- 明确 derived unit 不能反向改写 source truth。

### Slice 2: Freeze Source Family Closed Set

- 把 `official_web_public_notice` 与 `internal_notice_restricted` 写成唯一 admitted source family 集合。
- 明确这一步不新增 `fresh_news` family、`regulation_notice` family 或其他中间层别名。
- 与 `packages/contracts` 中现有 enum 对齐，避免 planning/contract 漂移。

### Slice 3: Freeze Public Notice Vs Fresh News Boundary

- 明确 public notice runtime 与 `fresh_news` retrieval 的分层：
  - public notice 进入 `notice-agent` / notice task routing
  - broader news 保持 freshness-sensitive retrieval surface
- 明确 source channel 共享不等于 serving/runtime posture 共享。
- 明确 `official_web_public_notice` 是 notice-like subset，而不是整个 fresh-news 面。

### Slice 4: Freeze Restricted Notice Posture

- 明确 `internal_notice_restricted` 继续保持 restricted / `offline_preparation` posture。
- 明确这条 family 当前只作为 future consumption-model input，不作为 opened runtime surface。
- 明确 future seam 也只能读取 projected metadata / canonical body，而不是 raw/source bundle 或 query-disabled retrieval alias。

### Slice 5: Freeze Phase-1 Role Taxonomy Boundary

- 把 admissible role examples 固定下来，但只到 taxonomy boundary，不进入正式字段设计。
- 明确 role taxonomy 的作用是说明“一条 notice 可以 fan-out 到多个消费角色”，不是在本 phase 定义完整 schema。
- 用 exemplar notice 保持问题锚点：
  - `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知`

### Slice 6: Prepare Handoff To Phase 2 And Phase 3

- 对 `Phase 2` 固定输入：
  - 哪些是 source-family truth
  - 哪些是 unit-level schema 问题
- 对 `Phase 3` 固定输入：
  - 哪些是 authority / precedence 问题
  - 哪些是 completeness / answerability 问题
- 明确后续 phase 不再重开 `fresh_news` opening 或 restricted runtime opening 的基础边界争论。

## Proposed Write Set

- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`

## Verification Matrix

- phase artifact verification
  - `Phase 1` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- boundary verification
  - planning truth 继续只承认两个 source family
  - planning truth 明确 `source_notice` 仍是 canonical upstream
  - planning truth 明确 `derived consumption unit` 是 downstream projection，而不是新 upstream
- posture verification
  - planning truth 不把 `official_web/fresh_news` 写成 notice runtime alias
  - planning truth 不把 `internal_notice_restricted` 写成已 opened query surface
- handoff verification
  - `Phase 2` 留给 schema
  - `Phase 3` 留给 authority / completeness
  - `Phase 1` 不越界实现 tool / query service / UI

## Exit Rule

Phase 1 完成后，repo 应达到：

- `official_web_public_notice` 与 `internal_notice_restricted` 的消费边界已经落盘
- `source_notice / notice_attachment / derived consumption unit` 的层次已经固定
- public notice runtime、restricted notice runtime、freshness-sensitive news retrieval 的分层已经写清
- `Phase 2` 可以直接围绕 derived-unit schema 开始工作
- `Phase 3` 可以直接围绕 authority / completeness 开始工作
