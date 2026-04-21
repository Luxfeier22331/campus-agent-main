---
doc_type: plan
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Execution Capability Family Convergence

## Goal

把 repo 的 execution capability family 从当前 mixed `*-specialist` / `*-agent` 命名与 label truth，
收口到一套长期一致的 family、contract、observability 与 prompt/eval vocabulary。

## This Document Covers

- `supervisor` 与下游 capability family 的长期命名约定
- `rag-specialist -> rag-agent` 为首的 family terminology freeze
- current-truth contract、`selected_target` label、observability label、prompt/eval label 的前向收敛
- package/runtime rename 是否真的执行的决策门槛，以及 admission 之后的 execution closeout

## This Document Does Not Cover

- `campus services / notices runtime admission` 自己的 tool contract 细节
- 某条 domain workstream 的实现优先级排序
- generic retrieval / ingestion / data-plane 结构性改造
- 为了命名迁移而重开 unrelated product/runtime scope

## Why This Is A Workstream

这不是单个包的局部重命名，而是 repo 级 execution truth 收口：

- current merged truth 仍大量使用 `rag-specialist`，并保留 `navigation-specialist` 等 current-truth label；早期实验性的 `availability-specialist` 已退休
- target architecture 已开始引入 `campus-services-agent`、`notice-agent`、`navigation-agent`
- 如果不把它作为长期 workstream 管理，后续 family label、contract enum、observability 与 prompt/eval 会长期混名

## Planned Direction

1. 先冻结前向 family naming：顶层保持 `supervisor`，下游稳定 family 默认采用 `<domain>-agent`。
2. current merged truth 在真正迁移前继续允许保留 legacy `*-specialist` package naming，但不得再新增新的 `*-specialist` family label。
3. 迁移顺序固定为：terminology freeze -> current-truth contract labels -> prompt/eval/observability labels -> package/runtime rename decision。
4. 这条线长期保持 repo-owned owner；后续新增 family 也应服从它冻结的 naming / label rules，而不是每条 workstream 自己发明一套。

## Planned Phases

- `Phase 1`
  - `Agent Family Terminology Freeze`
- `Phase 2`
  - `Current-Truth Contract Label Migration`
- `Phase 3`
  - `Prompt Eval And Observability Label Convergence`
- `Phase 4`
  - `Package And Runtime Rename Decision`
- `Phase 5`
  - `One-Shot Full Rename Execution`

## Handoff Note

这条 workstream 已经完成：

- `Phase 1: Agent Family Terminology Freeze`
- `Phase 2: Current-Truth Contract Label Migration`
- `Phase 3: Prompt Eval And Observability Label Convergence`

后续恢复时，应直接进入 `Phase 5: One-Shot Full Rename Execution`。
当前 baseline 已经固定：

- `selected_target` / `selectedTarget` 继续只表示 current runtime target
- current serialized contract 不承载 forward family label
- panel target filter / display label 已由显式 mapping 收口
- prompt-facing wording 已不再把 legacy runtime target label 当默认 persona
- eval 已显式拆分 raw runtime target assertion 与 capability family label
- observability / operator wording 已固定 raw target 与 derived label 分层
- `Phase 4` planning pack 已创建：
  - `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/CONTEXT.md`
  - `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/RESEARCH.md`
  - `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/PLAN.md`
- `Phase 4` 已完成：
  - `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/SUMMARY.md`
- `Phase 5` planning pack 已创建：
  - `.planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/CONTEXT.md`
  - `.planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/RESEARCH.md`
  - `.planning/workstreams/execution-capability-family-convergence/phases/phase-5-one-shot-full-rename-execution/PLAN.md`

当前不应回退重开 `Phase 1-4`。one-shot full rename 已被正式 admission；后续只收口 code/doc/test/planning 的单波次 cutover 与 targeted verification。
