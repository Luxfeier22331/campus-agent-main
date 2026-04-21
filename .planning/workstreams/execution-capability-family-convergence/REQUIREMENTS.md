---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Requirements: Execution Capability Family Convergence

## Goal

建立 repo 级长期 workstream，统一 execution capability family 的命名与 label truth，
避免 `*-specialist` / `*-agent` 在 current-truth、target architecture、contract、observability、prompt/eval 中长期混用。

## In Scope

- `supervisor` 与下游 stable capability family 的 naming freeze
- `rag-specialist -> rag-agent` 这类前向 family rename 策略
- current-truth contract example、enum、`selected_target` label 的迁移规划
- prompt docs、eval labels、observability / trace labels 的命名收敛
- package / runtime rename 的执行门槛、写集、顺序与验证矩阵
- 在 rename 已被 admission 后，执行 `rag-specialist` / `navigation-specialist` 到 `*-agent` 的单波次 cutover

## Non-goals

- 某个单独 domain tool 的具体 schema 设计
- 因命名迁移而重开 unrelated runtime/product scope
- 一次性把所有现有或未来 capability family 无差别全量重命名
- 把当前 merged truth 伪装成已经完成了 `*-agent` 迁移
- 引入 compatibility shim、dual naming alias 或长期并存的过渡路径

## Success Criteria

1. repo 存在一条长期 active workstream，显式 owner execution capability family naming。
2. `rag-specialist`、`navigation-specialist`、`campus-services-agent`、`notice-agent` 等 family 的前向命名规则被写成 planning truth，并显式记录 `availability-specialist` 已退休。
3. current-truth contract / prompt / eval / observability 的迁移顺序被固定，不再由每条局部 workstream 各自决定。
4. `Phase 4` 必须明确决定 rename 是否执行；一旦执行被 admission，必须有单独 execution phase 冻结 write set、顺序与验证矩阵。
5. 在真正迁移完成前，current merged truth 与 target truth 的差异被显式记录；迁移开始后，不允许 active canonical truth 长期停在半迁移状态。

## Canonical Entry

- `docs/plans/execution-capability-family-convergence.md`
