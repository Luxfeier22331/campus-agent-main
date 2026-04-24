---
workstream: notice-consumption-layer
created: 2026-04-21
updated: 2026-04-24
---

# Project State

## Current Position
**Status:** Completed
**Current Phase:** Closeout
**Current Phase Name:** Operator Query And Closeout
**Current Plan:** `.planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/PLAN.md`
**Total Phases:** 8
**Total Plans in Phase:** 1
**Progress:** 8/8 phases complete
**Last Activity:** 2026-04-24
**Last Activity Description:** Completed Phase 7 non-regulation coverage and Phase 8 operator/read-model closeout for internal_notice consumption projection truth.

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
- completed `Phase 6` artifacts:
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/SUMMARY.md`
- completed `Phase 7` artifacts:
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-7-non-regulation-derived-unit-coverage/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-7-non-regulation-derived-unit-coverage/SUMMARY.md`
- completed `Phase 8` artifacts:
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/SUMMARY.md`

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
- Phase 6 closeout：
  - repo-owned notice consumption projection shared model / in-memory store / Postgres store 已落地
  - `internal_notice_restricted` canonical rebuild path 已落地
  - `import_authenticated_notice_export` 已支持显式 projection rebuild seam
  - `regulations/institutional_rules` / `regulations/scoped_rules` materialization 已经通过 projection ready derived-unit truth 过滤 candidate
  - operator read-model 已能按 notice id 汇总 ready / held / manual / no-adoption units
- Phase 7 closeout：
  - `procurement_notice` notice category 与 projection unit 已落地
  - internal restricted `roster_publication` / `lecture_activity` no-adoption projection truth 已落地
  - `service_status_override` projection candidate 已落地，但继续 `held_in_notice_runtime`
  - `attachment_form_template` projection truth 已落地，但继续 `held_in_notice_runtime`
- Phase 8 closeout：
  - operator/read-model status 可以按 notice id 汇总 ready / held / manual / no-adoption units 与原因
  - explicit worker CLI `show_internal_notice_consumption_projection_status` 已落地
  - selected-notice rebuild 已改为 replace selected notices，避免局部 rebuild 留下 stale projection units

## Blockers

- 无外部 blocker。
- Closeout 后约束：
  - 不在本轮重开 query-serving 或 runtime opening
  - 不把 procurement / lecture / roster 这类 future/non-adopted family 混进 regulation target hardening
  - 不把 service-status 或 form-template candidate 升格成 campus-services runtime / document-center rollout
  - `authenticated-notice-regulation-consumption` 仍只负责 target-side hardening，不承接 generic middle-layer truth

## Verification

- Targeted implementation tests 已补：
  - projection store / builder 单元测试
  - import projection rebuild seam 测试
  - `internal_notice` institutional materialization projection ready gate 测试
  - explicit rebuild worker CLI 测试
  - operator status worker CLI 测试
  - procurement/no-adoption/service-status/form-template projection unit 测试
- planning verification:
  - `git diff --check -- .planning/PROJECT.md .planning/WORKSTREAMS.md .planning/workstreams/notice-consumption-layer/README.md .planning/workstreams/notice-consumption-layer/REQUIREMENTS.md .planning/workstreams/notice-consumption-layer/ROADMAP.md .planning/workstreams/notice-consumption-layer/STATE.md .planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/PLAN.md .planning/workstreams/notice-consumption-layer/phases/phase-7-non-regulation-derived-unit-coverage/PLAN.md .planning/workstreams/notice-consumption-layer/phases/phase-7-non-regulation-derived-unit-coverage/SUMMARY.md .planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/PLAN.md .planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/SUMMARY.md`

## Session Continuity

**Stopped At:** `notice-consumption-layer` implementation closeout complete for internal_notice.
**Resume File:** `.planning/workstreams/notice-consumption-layer/STATE.md`
