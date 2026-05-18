---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Official Web Targeted Collection Refactor

## Overview

本 roadmap 先冻结边界和 contract，再改 `app-api` control plane，最后改 collector、ingestion 和 panel。
顺序不能倒置：target contract 未冻结前，不并行推进 collector 重构。

当前只有 Phase 0 是 executable `PLAN.md`。Phase 1-9 保持 `OUTLINE.md`，
避免 GSD tooling 把尚未开始的后续阶段误判为 `in_progress`。

## Phase Status

- [x] **Phase 0: Boundary And Broad Crawl Freeze** - 明确旧 closeout 与新 target-first 重构边界，冻结 broad crawl 默认扩张。
- [x] **Phase 1: Target Contract** - 重写 target-source-map / consumer-denominator / source capability contract，并保持 canonical family naming。
- [x] **Phase 2: App-API Job Control Plane** - 增加 target job、candidate URL、attempt、shared artifact-verification projection 与 operator-safe projection schema。
- [x] **Phase 3: Target Workset Planner** - 重构 `/plans:resolve`，返回 target-scoped workset，而不是 host-first workset。
- [x] **Phase 4: Collector Executor Refactor** - collector 只执行 workset，不再默认从 enabled hosts/seeds broad crawl。
- [x] **Phase 5: Source-Truth And Validation** - source-truth manifest 补 target lineage，validator/QC gate 对 target lineage fail-closed。
- [x] **Phase 6: Ingestion Projection Admission** - ingestion 按 target family 分流 candidate/review/release，不让 inventory-only promotion。
- [x] **Phase 7: Operator Panel Projection** - panel 展示 target jobs、attempts、artifact verification 和 ingestion/release status。
- [x] **Phase 8: No-Promotion Live Seam** - 跑真实 local/dev no-promotion seam，证明全链路可重复且不写 current truth。
- [x] **Phase 9: Legacy Closeout And Acceptance** - 清理 legacy broad path、更新文档、关闭 workstream。

## Implementation Dependency

严格依赖顺序：

1. Phase 0 和 Phase 1 由主代理完成，冻结 contract。
2. Phase 2 和 Phase 3 可以在 contract 冻结后实现。
3. Phase 4 依赖 Phase 3 的 workset shape。
4. Phase 5 依赖 Phase 4 的 artifact metadata。
5. Phase 6 依赖 Phase 5 的 source-truth target lineage。
6. Phase 7 依赖 Phase 2/6 的 operator projection。
7. Phase 8 依赖 Phase 4/6 的 no-promotion path。
8. Phase 9 只在 live seam 通过后执行。

## Phase Promotion Rule

- 后续 phase 从 `OUTLINE.md` 晋升为 `PLAN.md` 前，必须先完成上一 phase 的 `SUMMARY.md`。
- 每次只允许一个未完成 `PLAN.md` 存在，除非显式拆出可并行且写集不重叠的子 workstream。
- 晋升时必须重新检查 canonical naming、source-handoff ownership 与 Worker/runtime gate 是否仍与当前代码一致。

## Close Rule

本 workstream 只有在以下条件满足后关闭：

- 默认 official-web collection path 已 target-first。
- broad crawl 只保留显式 operator/debug path，且不会 handoff/promote。
- no-promotion live seam 有当前 evidence。
- protected panel 不读取非 app-api truth。
- docs、contracts、tests 和 workstream state 全部同步。
