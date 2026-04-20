---
doc_type: phase_plan
phase: "04"
phase_name: "Planning Closeout And Follow-up Routing"
status: completed
created: 2026-04-20
updated: 2026-04-20
---

# Phase 04 Plan

## Objective

把首条 handbook-derived `service_navigation_document` bounded slice
正式收口为 planning truth，
并明确这条 workstream 的完成状态与未来 reopen routing。

## Why This Phase Exists

实现和验证都已完成，
但如果不做 closeout，repo 仍会在 planning 层留下歧义：

- 当前 workstream 是否已完成
- 未来还有没有默认待做的实现任务
- 哪些 follow-up 需要另行 admission

## Locked Scope

- 只收口当前首条 bounded slice：
  - `中央民族大学学生公寓管理工作流程`
- 不新增第二条 target
- 不扩到 query-serving、course map、auth、regulation、retrieval rollout
- 不借 closeout 顺手打开新的产品范围

## Decisions To Freeze

1. 当前 workstream 的完成口径以首条 bounded slice 完成为准，不以 `campus_services` 全量 image-heavy hardening 为准。
2. future follow-up 只有在新的 product admission 或新的 bounded target 被明确提出时才恢复。
3. `Phase 04` 的主要输出是 planning truth，不是新代码或新验证命令。

## Execution Slices

### Slice 1: Freeze Completion Statement

- 明确当前已完成的事实：
  - exact selector contract
  - bounded multimodal admission
  - bounded hybrid materialization
  - fail-close semantics
  - raw / replay convergence
  - rebuild cleanup integration

Reason:

- 没有统一 completion statement，workstream 很容易在后续恢复时重新开启已完成问题。

### Slice 2: Route Remaining Gaps

- 明确当前“不再属于这条线的工作”：
  - 新的 `campus_services` image-heavy targets
  - query-serving opening
  - course map / topology parsing
  - auth / regulation / retrieval follow-up

Reason:

- closeout 的核心是把 remaining gaps 正确移出，而不是继续堆在当前 workstream 上。

### Slice 3: Update Registry Truth

- 更新：
  - `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
  - `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
  - `.planning/WORKSTREAMS.md`
- 使 repo 级 registry 与 workstream phase truth 一致

Reason:

- registry truth 不更新，closeout 仍不成立。

### Slice 4: Write Final Summary

- 为本 workstream 写 final closeout summary 或等价收口记录
- 明确 reopen rule：
  - 只有在产品范围重新提升 `campus_services/*` offline-preparation quality hardening 优先级
  - 或明确 admission 新的 bounded target
  时才恢复

Reason:

- 这为后续恢复提供最小且稳定的入口。

## Proposed Write Set

- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/04-planning-closeout-and-follow-up-routing/PLAN.md`
- 可选：
  - `.planning/workstreams/campus-services-offline-preparation-hardening/phases/04-planning-closeout-and-follow-up-routing/SUMMARY.md`
  - `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`

## Verification Matrix

- planning verification
  - `Phase 03` 有正式 `SUMMARY.md`
  - `Phase 04` 目录有 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - repo-level `WORKSTREAMS.md` 与 workstream `STATE/ROADMAP` 一致
- scope verification
  - closeout 不重新 admission 新目标
  - reopen rule 清晰
  - future work routing 不与其他 active/deferred workstream 混淆

## Exit Rule

Phase 04 完成时，repo 应达到：

- 当前首条 bounded slice 已被正式视为 complete
- workstream registry / state / roadmap 已一致
- 后续若无新的 product admission，不再默认继续这条线的实现工作
