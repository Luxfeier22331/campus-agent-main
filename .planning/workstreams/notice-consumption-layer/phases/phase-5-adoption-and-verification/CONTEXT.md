---
phase: "5"
name: "Adoption And Verification"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 5 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 用 bounded exemplar 验证前四个 phase 的 modeling truth 是否闭环
- 冻结 role/source-family 到现有或 future workstream 的 adoption routing
- 明确哪些 roles 当前没有产品 adoption 目标
- 为这条 workstream 的 planning closeout 提供 handoff note

它不负责：

- 直接实现 projection、query service、UI 或 runtime opening
- 重开 `Phase 1-4` 的 boundary / schema / authority / handoff rule
- 发明新的 target collection 或新的 runtime family
- 让尚无产品 scope 的 notice family 静默变成 query-facing candidate

</domain>

<current_truth>
## Current Truth

- `Phase 1-4` 已冻结：
  - source family boundary
  - derived-unit schema
  - authority / completeness / answerability
  - agent / surface handoff
- 当前 exemplar 固定为：
  - `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知`
- repo 当前已有明确 adoption destination 的 workstream / lane 包括：
  - deferred `authenticated-notice -> regulation downstream consumption`
  - backlog `official-web source channel / news opening`
  - completed `campus services / notices runtime admission`
  - deferred `restricted document rollout / verification`
- repo 当前也已有显式“不做产品消费”的真相：
  - `internal_notice_restricted` 的 `lecture_activity`
  - `internal_notice_restricted` 的 `roster_publication`
  继续保留 source-triage / provenance truth，但不进入当前产品消费目标

</current_truth>

<decisions>
## Implementation Decisions

- **05-01:** exemplar verification 固定至少验证同一条 `source_notice` 下的 mixed outcome：
  - `notice_window`
  - `annual_cycle_rule`
  不会在消费面混淆。
- **05-02:** exemplar 当前-state routing 固定为：
  - `notice_window`
    - `semantic_owner=notice_body`
    - `completeness_status=complete`
    - `answerability=answerable`
    - `default_agent=notice-agent`
    - `target_surface=notice_runtime`
  - `annual_cycle_rule`
    - 若 attachment rule body 未恢复：
      - `semantic_owner=authority_pending`
      - `completeness_status=authoritative_attachment_missing`
      - `answerability=not_answerable`
      - `default_agent=notice-agent`
      - `target_surface=notice_runtime`
- **05-03:** exemplar future-state routing 固定为：
  - 同一 `annual_cycle_rule`
    - 若 attachment owner 已恢复且 unit `complete + answerable`
      - `semantic_owner=attachment_document`
      - `default_agent=future rag-agent`
      - `target_surface=regulations/scoped_rules`
- **05-04:** adoption routing 固定按 role family 收口：
  - stable formal `attachment_rule_body`
    - -> deferred `authenticated-notice -> regulation downstream consumption`
    - -> `regulations/institutional_rules`
  - `annual_cycle_rule` / `time_bound_operational_rule`
    - -> deferred `authenticated-notice -> regulation downstream consumption`
    - -> `regulations/scoped_rules`
  - `service_status_override`
    - -> future/reopened campus-services structured runtime implementation lane
    - 当前 repo 没有独立 native workstream，则继续只保留 handoff truth
  - public-source `lecture_activity` / publication-like notice
    - -> backlog `official-web source channel / news opening`
    - 或 future dedicated publication/notice surface workstream
  - `attachment_form_template`
    - -> future restricted document center / restricted rollout lane
    - 当前无已 admission native workstream 时，继续停在 notice lane
- **05-05:** 以下 role/source-family 组合当前固定没有产品 adoption 目标：
  - `internal_notice_restricted + roster_publication`
  - `internal_notice_restricted + lecture_activity`
  它们继续只保留 source-triage / provenance truth，不推进 query-facing mirror surface。
- **05-06:** 这条 workstream 的 closeout 输出不是代码，而是一套 repo-tracked modeling truth；后续实现必须回到对应 adoption target workstream，而不是重开本 workstream 争论基础边界。

</decisions>

<specifics>
## Specific Gaps

- 还没有把 exemplar 的 current-state / future-state routing 写成 phase-local worked example。
- 还没有把 `service_status_override`、`attachment_form_template` 这类 role 的 adoption route 明确映射到现有或 future workstream。
- 还没有把“当前无产品 adoption 目标”的 role/source-family 组合显式列出来。

</specifics>

<canonical_refs>
## Canonical References

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

</canonical_refs>

<deferred>
## Deferred Follow-up

- related implementation/adoption workstreams
- final archive / completion ceremony for this planning line
- any future reopen triggered by:
  - source family set change
  - unit schema change
  - authority/completeness rule change
  - new product consumption target family admission

</deferred>
