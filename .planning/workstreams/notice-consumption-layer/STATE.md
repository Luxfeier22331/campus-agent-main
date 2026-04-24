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
**Last Activity Description:** Completed Phase 7 non-regulation coverage,
Phase 8 operator/read-model closeout, and semantic split for archive /
projection / read-model / query-runtime terminology.

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
  - `source_notice -> notice_attachment -> derived consumption unit` fan-out
    boundary 已冻结
  - public/restricted notice source family、authority / completeness /
    answerability 与 agent/surface handoff 已冻结
  - exemplar `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知`
    已写实 current-state / future-state 双路由
- adoption route 继续有效：
  - `attachment_rule_body` -> `authenticated-notice-regulation-consumption`
    -> `regulations/institutional_rules`
  - `annual_cycle_rule` / `time_bound_operational_rule`
    -> `authenticated-notice-regulation-consumption` -> `regulations/scoped_rules`
  - public-source `lecture_activity` / publication-like unit -> backlog
    `official-web-source-channel-news-opening`
  - `service_status_override` 与 `attachment_form_template` 只冻结 future
    adoption direction，不编造 native implementation workstream
- no-adoption truth 继续有效：
  - `internal_notice_restricted + roster_publication`
  - `internal_notice_restricted + lecture_activity`
  - 两者继续只保留 source-triage / provenance truth
- Phase 6 closeout：
  - repo-owned notice consumption projection shared model / in-memory store /
    Postgres store 已落地
  - `internal_notice_restricted` canonical rebuild path 已落地
  - `import_authenticated_notice_export` 已支持显式 projection rebuild seam
  - `regulations/institutional_rules` / `regulations/scoped_rules`
    materialization 已经通过 projection ready derived-unit truth 过滤 candidate
  - operator read-model 已能按 notice id 汇总 ready / held / manual /
    no-adoption units
- Phase 7 closeout：
  - `procurement_notice` notice category 与 projection unit 已落地
  - internal restricted `roster_publication` / `lecture_activity` no-adoption
    projection truth 已落地
  - `service_status_override` projection candidate 已落地，target surface 为
    `campus_services/service_status_candidate`，但状态仍是
    `retained_for_notice_query`
  - `attachment_form_template` projection truth 已落地，target surface 为
    `notice_level_query`，状态仍是 `retained_for_notice_query`
- Phase 8 closeout：
  - operator/read-model status 可以按 notice id 汇总 ready / held / manual /
    no-adoption units 与原因
  - explicit worker CLI `show_internal_notice_consumption_projection_status` 已落地
  - selected-notice rebuild 已改为 replace selected notices，避免局部 rebuild 留下
    stale projection units
  - `import_authenticated_notice_export` 可在 projection store / read-model store
    存在时为本次 imported notices 显式重建 internal_notice query read model
  - `packages/notice-agent` 已补 internal notice read-model backing query service，
    使用 PG/read-model repository + derived bucket canonical markdown body adapter，
    并保留 restricted authorization fail-close
- Semantic split closeout：
  - `notice_runtime` 不再作为新写入 projection target/status 语义
  - notice-level query 候选写入 `target_surface=notice_level_query`
  - procurement 历史通知写入 `target_surface=procurement_notice_history`
  - internal restricted no-adoption 写入 `target_surface=unsupported`
  - `held_in_notice_runtime` 保留为旧常量名兼容 alias；新状态值为
    `retained_for_notice_query`

## Blockers

- 无外部 blocker。
- Closeout 后约束：
  - 不在本轮重开 query-serving 或 runtime opening
  - 不把 procurement / lecture / roster 这类 future/non-adopted family 混进
    regulation target hardening
  - 不把 service-status 或 form-template candidate 升格成 campus-services runtime /
    document-center rollout
  - `authenticated-notice-regulation-consumption` 仍只负责 target-side hardening，
    不承接 generic middle-layer truth

## Verification

- Targeted implementation tests 已补：
  - projection store / builder 单元测试
  - import projection rebuild seam 测试
  - import read-model rebuild seam 测试
  - internal notice read-model builder/store/worker 测试
  - notice-agent read-model backing query service 测试
  - `internal_notice` institutional materialization projection ready gate 测试
  - explicit rebuild worker CLI 测试
  - operator status worker CLI 测试
  - procurement/no-adoption/service-status/form-template projection unit 测试
- planning verification:
  - `git diff --check -- ...notice-consumption-layer...`

## Session Continuity

**Stopped At:** `notice-consumption-layer` implementation closeout complete for
internal_notice.
**Resume File:** `.planning/workstreams/notice-consumption-layer/STATE.md`
