---
phase: "04"
name: "Planning Closeout And Follow-up Routing"
created: 2026-04-20
updated: 2026-04-20
status: pending
---

# Phase 04 Context

## Goal

把首条 handbook-derived `service_navigation_document` bounded slice
的完成证据、剩余边界和后续 follow-up routing
正式写回 planning truth，
避免 workstream 下次恢复时重新讨论：

- 这条 slice 是否已经完成
- 当前还剩什么
- 哪些问题不应继续挂在这条线下

## Current Truth

- `Phase 1` 已冻结 selector、artifact boundary、lineage 与 fail-close 口径。
- `Phase 01.1` 已完成 bounded multimodal probe admission。
- `Phase 02` 已完成 bounded hybrid materialization。
- `Phase 03` 已完成 targeted verification / rebuild integration closeout。
- 当前首条 slice 的技术完成态已足够清晰：
  - exact bounded selector
  - projection-local hybrid lane
  - `flow-graph.json`
  - raw / replay convergence
  - cleanup / rebuild integration

## Why This Phase Exists

如果没有 `Phase 04`，
repo 会留下一个常见的 planning 尾巴：

- 代码与测试都完成了
- 但 workstream registry / closeout truth / reopen rule 还没同步

这会让后续恢复再次回到“先判断这条 workstream 到底是完成了还是还在做”。

## Locked Scope

- 只处理首条 bounded slice 的 planning closeout
- 不新增新的 campus services target
- 不打开 `service_catalog` query-serving
- 不把 course map、auth、regulation、retrieval rollout 混进本 phase
- 不把 source-truth 全量采集或长期 document center 范围重新拉进本 phase

## Canonical References

- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/STATE.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/ROADMAP.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/02-bounded-handbook-service-navigation-ocr-materialization/SUMMARY.md`
- `.planning/workstreams/campus-services-offline-preparation-hardening/phases/03-service-navigation-targeted-verification-and-rebuild-integra/SUMMARY.md`
- `docs/plans/archive/completed/campus-services-offline-preparation-hardening.md`

## Expected Output

- 一个正式的 `Phase 04` closeout plan
- 明确 workstream 完成口径与 reopen rule
- 明确后续 follow-up 不再默认挂在这条 workstream 上
