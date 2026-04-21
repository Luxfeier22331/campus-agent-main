---
doc_type: phase_plan
phase: "4"
phase_name: "Agent And Surface Handoff"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 4 Plan

## Objective

冻结 `derived consumption unit -> default_agent / target_surface` 的 handoff contract，
让后续 work 不再重复争论“哪些 unit 应继续停在 notice runtime”“哪些只是 future
rag/service candidate”“publication-like unit 现在归谁持有”，并为 `Phase 5` 的 adoption
route 与 worked example closeout 提供稳定输入。

## Why This Phase Exists

当前 repo 已经有：

- `Phase 2` 冻结后的 `default_agent` / `target_surface` 字段位
- `Phase 3` 冻结后的 owner / completeness / answerability rule
- 已完成的 runtime admission workstream，对 `notice-agent`、`campus-services-agent`、`rag-agent` 的 owner boundary 与 tool seam 有稳定 truth

当前 repo 还没有：

- `default_agent` / `target_surface` 的正式 derivation rule
- 哪些 states 必须继续停在 `notice_runtime`
- 哪些 states 只是 future downstream surface candidate
- `publication_surface_candidate` 的当前解释

如果不先做这一步，后续 phase 会持续漂移：

- `body_only_answerable` 会不会被误送到 `rag-agent`
- `service_status_override` 会不会在没 projection 的情况下直接交给 `campus-services-agent`
- `roster_publication` / `lecture_activity` 会不会因为没有 dedicated runtime 被乱塞进 generic RAG
- restricted notice source family 会不会因为 target hint 被误写成已开放 runtime

## Locked Inputs

- `default_agent` / `target_surface` 在 `Phase 2` 已是正式字段，但仍只是 hint。
- `semantic_owner` / `completeness_status` / `answerability` 在 `Phase 3` 已有正式 derivation。
- runtime admission workstream 已冻结：
  - `notice-agent`
    - `campus_notice_discover`
    - `campus_notice_get`
  - `campus-services-agent`
    - `service_status_lookup`
    - `transport_schedule_lookup`
  - `rag-agent`
    - default retrieval-oriented knowledge owner
- `regulations/institutional_regulations` / `regulations/scoped_rules` split 已由 ADR-0036 / ADR-0037 冻结。
- 本 phase 不 admission 新 tool、新 runtime family、新 opening gate。

## Decisions To Freeze

1. `notice_runtime` 固定是 notice-derived units 的默认 holding surface。
2. 显式 notice task 的第一入口固定仍是 `notice-agent`；任何 future downstream adoption 都不改写这条 entry truth。
3. `default_agent=notice-agent` 的适用条件固定包括：
   - unit 仍停留在 `notice_runtime`
   - unit 仍是 `publication_surface_candidate`
   - unit 只有 `body_only_answerable`
   - unit 是 `manual_review_required` / `reference_only` / `not_answerable`
4. `default_agent=future rag-agent` 只允许在以下条件同时成立时出现：
   - `semantic_owner` 已稳定，不是 `wrapper_notice` / `authority_pending`
   - `completeness_status=complete`
   - `answerability=answerable`
   - `target_surface` 是 `regulations/institutional_regulations` 或 `regulations/scoped_rules`
5. `default_agent=future campus-services-agent` 只允许在以下条件同时成立时出现：
   - `primary_role` 与 service runtime 语义相容
   - `semantic_owner` 已稳定
   - `completeness_status=complete`
   - `answerability=answerable`
   - `target_surface=service_status_runtime`
6. `body_only_answerable`、`manual_review_required`、`reference_only`、`not_answerable` 固定不得 handoff 给 future `rag-agent` / `campus-services-agent` 作为 canonical owner truth。
7. `notice_window` 固定映射为：
   - `default_agent=notice-agent`
   - `target_surface=notice_runtime`
8. `annual_cycle_rule` 固定映射为：
   - `target_surface=regulations/scoped_rules`
   - 只有 `complete + answerable` 时，`default_agent` 才允许切向 future `rag-agent`
   - 否则继续 `notice-agent + notice_runtime`
9. `time_bound_operational_rule` 固定映射为：
   - 默认 `target_surface=regulations/scoped_rules`
   - 只有当它被进一步收口为 current-effective service override truth 时，才允许切向 `service_status_runtime`
10. `service_status_override` 固定映射为：
    - `target_surface=service_status_runtime`
    - 只有 `complete + answerable` 时，`default_agent` 才允许切向 future `campus-services-agent`
    - 否则继续 `notice-agent + notice_runtime`
11. public-source `lecture_activity` 与其他 publication-like unit 固定映射为：
    - `target_surface=publication_surface_candidate`
    - `default_agent=notice-agent`
    直到 dedicated publication runtime 被单独 admission
12. `internal_notice_restricted` 的 `lecture_activity` / `roster_publication` 当前不构成产品 adoption candidate；它们继续停在 source-triage / provenance truth，不推进 query-facing surface。
13. `attachment_rule_body` 固定映射为：
    - stable formal rule body -> `regulations/institutional_regulations`
    - scoped annual/time-bound rule body -> `regulations/scoped_rules`
    - 但两者都要求 `complete + answerable` 才能离开 notice lane
14. `attachment_form_template` 第一版固定继续留在：
    - `default_agent=notice-agent`
    - `target_surface=notice_runtime`
15. `internal_notice_restricted` 与 `official_web_public_notice` 共享大部分 handoff matrix，但 restricted family 的 runtime opening 继续保持单独 closed-by-default gate；其中 internal `lecture_activity` / `roster_publication` 仍被排除在当前产品 adoption 之外。
16. future `rag-agent` / `campus-services-agent` 只能消费 repo-owned downstream projection，不得把 `campus_notice_get` 或 raw notice body 当成自己的 canonical owner query seam。

## Execution Slices

### Slice 1: Freeze Holding Surface Rule

- 明确 `notice_runtime` 是默认 holding surface。
- 明确 `notice-agent` 是默认 holding owner。
- 明确这是 handoff truth，不是 opening truth。

### Slice 2: Freeze Downstream Eligibility Gate

- 明确只有 `complete + answerable` unit 才可能进入下游 semantic-owner surface。
- 明确 `body_only_answerable` / `manual_review_required` / `reference_only` / `not_answerable` 继续留在 notice lane。

### Slice 3: Freeze Role-To-Surface Mapping

- `notice_window` -> `notice_runtime`
- `annual_cycle_rule` -> `regulations/scoped_rules`
- `time_bound_operational_rule` -> default `regulations/scoped_rules`
- `service_status_override` -> `service_status_runtime`
- public-source `lecture_activity` / publication-like unit -> `publication_surface_candidate`
- `attachment_rule_body` -> regulation target split by semantic nature
- `attachment_form_template` -> `notice_runtime`

### Slice 4: Freeze Agent Handoff Gate

- `notice-agent`
  - default holding owner
- future `rag-agent`
  - only for regulation/scoped-rule candidate with stable owner and full completeness
- future `campus-services-agent`
  - only for service-shaped current-effective override candidate with stable owner and full completeness

### Slice 5: Freeze Restricted/Public Posture Split

- 明确 public / restricted source family 共享 semantic handoff matrix。
- 明确 restricted runtime opening 仍独立 gated。
- 明确 target hint 不等于 restricted runtime 已打开。

### Slice 6: Prepare Phase 5 Worked Example

- exemplar notice 至少要能说明：
  - `notice_window`
    - `notice-agent + notice_runtime`
- `annual_cycle_rule`
    - 若 attachment 缺失 -> 继续 `notice-agent + notice_runtime`
    - 若 future attachment owner 完整恢复 -> future `rag-agent + regulations/scoped_rules`
- `internal_notice_restricted` 的 `roster_publication` / `lecture_activity`
  - 继续停在 source-triage / provenance truth，不进入当前产品 adoption

## Proposed Write Set

- `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/WORKSTREAMS.md`
- `docs/plans/archive/completed/notice-consumption-layer.md`

## Verification Matrix

- phase artifact verification
  - `Phase 4` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- planning progression verification
  - `ROADMAP.md` 将 `Phase 3` 标记为已完成
  - `WORKSTREAMS.md` 的当前 phase 前移到 `Phase 4`
- handoff verification
  - planning truth 明确 `notice-agent` 是默认 holding owner
  - planning truth 明确 `body_only_answerable` 等状态不能 handoff 给 future `rag-agent` / `campus-services-agent`
  - planning truth 明确 `annual_cycle_rule` / `time_bound_operational_rule` 的 target surface 是 `regulations/scoped_rules`
  - planning truth 明确 `publication_surface_candidate` 当前仍由 `notice-agent` 承接
- scope verification
  - planning truth 不重开 runtime admission
  - planning truth 不打开 restricted runtime
  - planning truth 不新增 publication runtime

## Exit Rule

Phase 4 完成后，repo 应达到：

- `default_agent` / `target_surface` 的 derivation 已经冻结
- notice-derived unit 的 holding lane 与 downstream candidate lane 已经分开
- future `rag-agent` / `campus-services-agent` 的接入门槛已经写清
- `publication_surface_candidate` 的当前解释已经稳定
- `Phase 5` 可以直接做 exemplar closeout 与 adoption route
