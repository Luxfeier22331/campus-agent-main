---
workstream: notice-consumption-layer
created: 2026-04-21
updated: 2026-04-24
---

# Project State

## Current Position
**Status:** Active
**Current Phase:** Phase 6
**Current Phase Name:** Projection And Consumer Foundation
**Current Plan:** `.planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/PLAN.md`
**Total Phases:** 8
**Total Plans in Phase:** 1
**Progress:** 5/8 phases complete
**Last Activity:** 2026-04-24
**Last Activity Description:** Reopened the workstream after confirming that `notice-consumption-layer` had only closed semantic modeling, while repo code still lacked a persistent consumption projection between `source_notice` and downstream consumers.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/PLAN.md`
- completed `Phase 2` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/PLAN.md`
- completed `Phase 3` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/PLAN.md`
- completed `Phase 4` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/PLAN.md`
- completed `Phase 5` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/SUMMARY.md`
- current `Phase 6` artifact:
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/PLAN.md`

- preserved modeling truth:
  - `source_notice -> notice_attachment -> derived consumption unit` fan-out boundary 已冻结
  - public/restricted notice source family、authority / completeness / answerability 与 agent/surface handoff 已冻结
  - exemplar `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知` 已写实 current-state / future-state 双路由
- adoption route 继续有效：
  - `attachment_rule_body` -> `authenticated-notice-regulation-consumption` -> `regulations/institutional_rules`
  - `annual_cycle_rule` / `time_bound_operational_rule` -> `authenticated-notice-regulation-consumption` -> `regulations/scoped_rules`
  - public-source `lecture_activity` / publication-like unit -> backlog `official-web-source-channel-news-opening`
  - `service_status_override` 与 `attachment_form_template` 只冻结 future adoption direction，不编造 native implementation workstream
- no-adoption truth 继续有效：
  - `internal_notice_restricted + roster_publication`
  - `internal_notice_restricted + lecture_activity`
  - 两者继续只保留 source-triage / provenance truth
- 当前 reopen 原因：
  - repo 代码仍缺失 repo-owned notice consumption projection store
  - `internal_notice` downstream consumer 仍直接从 source holding collection 扫描/判定，而不是读取 persisted derived-unit metadata truth
  - 因此 “这条线已完成” 只对 modeling 成立，不对 implementation 成立
- 当前 slice：
  - 落地 `notice consumption projection` store 与 shared model
  - 先在 `internal_notice_restricted` source family 上补 canonical rebuild path
  - 让 `regulations/institutional_rules` / `regulations/scoped_rules` materialization 通过 projection 过滤 ready candidates

## Blockers

- 无外部 blocker。
- 当前约束：
  - 不在本轮重开 query-serving 或 runtime opening
  - 不把 procurement / lecture / roster 这类 future/non-adopted family 混进 regulation target hardening
  - `authenticated-notice-regulation-consumption` 仍只负责 target-side hardening，不承接 generic middle-layer truth

## Verification

- implementation reopen in progress；本轮需要补：
  - projection store / builder 单元测试
  - `internal_notice` institutional/scoped materialization targeted tests
- planning verification:
  - `git diff --check -- .planning/PROJECT.md .planning/WORKSTREAMS.md .planning/workstreams/notice-consumption-layer/README.md .planning/workstreams/notice-consumption-layer/REQUIREMENTS.md .planning/workstreams/notice-consumption-layer/ROADMAP.md .planning/workstreams/notice-consumption-layer/STATE.md .planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/PLAN.md docs/plans/archive/completed/notice-consumption-layer.md`

## Session Continuity

**Stopped At:** `Phase 6` projection/store foundation 与 consumer rewiring 正在推进
**Resume File:** `.planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/PLAN.md`
