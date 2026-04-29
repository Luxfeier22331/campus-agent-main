---
doc_type: phase_plan
phase: "5"
phase_name: "Adoption And Verification"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 5 Plan

## Objective

用 worked example 验证 `notice consumption layer` 的 modeling truth 已经闭环，
并把每类 role/source-family 的 adoption route 回流到 repo 当前真实存在的 workstream / backlog /
non-goal 边界，避免这条 workstream 继续悬空。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 1` source family boundary
- `Phase 2` unit schema
- `Phase 3` authority / completeness / answerability
- `Phase 4` agent / surface handoff

当前 repo 还没有：

- phase-local worked example closeout
- role/source-family -> adoption target route table
- 明确的 no-adoption case 清单

如果不先做这一步，后续会持续出现三种返工：

- 实施 workstream 不知道该接哪类 unit
- 同一 exemplar notice 的 current-state / future-state 路由被混成一条
- 没有产品目标的 role 被误塞进新闻、RAG 或 service runtime

## Locked Inputs

- exemplar notice 已固定。
- `notice_window` / `annual_cycle_rule` 的 mixed outcome 已在前一 phase 冻结。
- repo 当前真实存在的 adoption destination 已知：
  - deferred `authenticated-notice-regulation-consumption`
  - backlog `official-web-source-channel-news-opening`
  - deferred `restricted-document-rollout-verification`
- 对 internal restricted `lecture_activity` / `roster_publication` 的 no-adoption truth 已由 ADR-0032 冻结。

## Decisions To Freeze

1. exemplar current-state route 固定为：
   - `notice_window`
     - `notice_body`
     - `complete`
     - `answerable`
     - `notice-agent`
     - `notice_runtime`
   - `annual_cycle_rule`
     - `authority_pending`
     - `authoritative_attachment_missing`
     - `not_answerable`
     - `notice-agent`
     - `notice_runtime`
2. exemplar future-state route 固定为：
   - 同一 `annual_cycle_rule`
     - 当 attachment owner 完整恢复并满足 `complete + answerable`
     - handoff 到 future `rag-agent`
     - target 为 `regulations/scoped_rules`
3. `attachment_rule_body` adoption 固定回流到：
   - deferred `authenticated-notice-regulation-consumption`
   - 其中 target split 继续遵循：
     - stable formal rule body -> `regulations/institutional_rules`
     - annual/time-bound scoped rule body -> `regulations/scoped_rules`
4. `annual_cycle_rule` / `time_bound_operational_rule` adoption 固定回流到：
   - deferred `authenticated-notice-regulation-consumption`
   - 后续 query policy 继续看 `internal-notice-manual-review-future-query-contract`
5. `service_status_override` adoption 固定为：
   - future/reopened campus-services structured runtime implementation lane
   - 在 native workstream 被 admission 前，只保留 handoff truth，不推进实现
6. public-source `lecture_activity` / publication-like unit adoption 固定为：
   - backlog `official-web-source-channel-news-opening`
   - 或 future dedicated publication runtime workstream
7. `attachment_form_template` adoption 固定为：
   - future restricted document-center / rollout lane
   - 当前最近的 repo-owned related lane是 `restricted-document-rollout-verification`
   - 在 dedicated surface admission 前继续停在 notice lane
8. 以下组合固定列为 no-adoption case：
   - `internal_notice_restricted + roster_publication`
   - `internal_notice_restricted + lecture_activity`
9. 这条 workstream 完成后的默认下一步，不是继续重开 modeling，而是按上面的 adoption route 去恢复 / 新建对应 workstream。

## Execution Slices

### Slice 1: Freeze Worked Example

- 把 exemplar 写成 current-state / future-state 双路由。
- 明确 current-state 的 fail-close 不影响同 notice 下 `notice_window` 的可答性。

### Slice 2: Freeze Regulation Adoption Route

- `attachment_rule_body`
- `annual_cycle_rule`
- `time_bound_operational_rule`
全部明确回流到 deferred `authenticated-notice-regulation-consumption`。

### Slice 3: Freeze Service / Publication / Document-Center Route

- `service_status_override`
  - future campus-services implementation lane
- public-source `lecture_activity`
  - official-web news/publication opening lane
- `attachment_form_template`
  - future restricted document-center / rollout lane

### Slice 4: Freeze No-Adoption Cases

- `internal_notice_restricted + roster_publication`
- `internal_notice_restricted + lecture_activity`
- 明确它们只保留 source-triage / provenance truth

### Slice 5: Freeze Closeout Guidance

- 下一次恢复时：
  - 不再重开基础 modeling
  - 直接按 adoption target 继续

## Proposed Write Set

- `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/notice-consumption-layer.md`

## Verification Matrix

- phase artifact verification
  - `Phase 5` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- worked-example verification
  - planning truth 显式写出 exemplar current-state route
  - planning truth 显式写出 exemplar future-state route
- adoption-route verification
  - regulation/scoped-rule adoption route 指向真实存在的 deferred workstream
  - public-source publication/news adoption route 指向真实存在的 backlog workstream
  - internal restricted lecture/roster 被明确列为 no-adoption case
- scope verification
  - planning truth 不编造不存在的 active workstream
  - planning truth 不重开前四个 phase 的基础边界

## Exit Rule

Phase 5 完成后，repo 应达到：

- exemplar 的 worked example 已经闭环
- 每类 role/source-family 的 adoption route 已经写回 repo planning truth
- no-adoption case 已经显式落盘
- 后续会话可以直接转去相关 workstream，而不必继续重开 notice consumption modeling
