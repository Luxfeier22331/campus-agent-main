---
doc_type: plan
status: completed
created: 2026-04-21
updated: 2026-04-22
---

# Notice Consumption Layer

## Completion Note

这条 `notice consumption layer` workstream 已关闭。
它本轮完成的不是新的 projection / runtime 实现，而是 notice semantic modeling 的 planning closeout：
冻结 `source_notice / notice_attachment / derived consumption unit` 的关系、source family boundary、
authority / completeness contract、agent/surface handoff truth，以及 `Phase 5`
的 exemplar worked example / adoption routing / no-adoption case。

## What This Plan Closed

- 冻结 `source_notice -> notice_attachment -> derived consumption unit` 的 semantic fan-out contract
- 冻结 public / restricted notice source family boundary
- 冻结 `primary_role`、`semantic_owner`、`default_agent`、`target_surface`、`temporal_policy`、`completeness_status` 与 `answerability` 的 modeling truth
- 冻结 notice body、attachment body、wrapper text 的 authority / precedence 与 fail-close 语义
- 用 exemplar `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知` 收口 current-state / future-state 双路由
- 把 role/source-family adoption route 回写到 repo 当前真实存在的 workstream / backlog：
  - `attachment_rule_body` -> `authenticated-notice-regulation-consumption` -> `regulations/institutional_regulations`
  - `annual_cycle_rule` / `time_bound_operational_rule` -> `authenticated-notice-regulation-consumption` -> `regulations/scoped_rules`
  - public-source `lecture_activity` / publication-like unit -> backlog `official-web-source-channel-news-opening`
  - `service_status_override` / `attachment_form_template` 只冻结 future adoption direction，不编造 native workstream
- 显式列出 no-adoption case：
  - `internal_notice_restricted + roster_publication`
  - `internal_notice_restricted + lecture_activity`

## Current Canonical Entry

- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/README.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/SUMMARY.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在 admitted notice source family 被显式改写、
derived consumption unit schema 被显式改写、
authority / completeness contract 被显式改写，
或新的产品 adoption target family 被正式 admission 时，
才应恢复这条 workstream。
