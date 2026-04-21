---
doc_type: plan
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Execution Capability Family Convergence

## Completion Note

这条 repo-owned naming convergence workstream 已关闭。
它完成的是 `rag-specialist` / `navigation-specialist` 到 `rag-agent` / `navigation-agent` 的单波次 runtime/package/import/contract/doc/test/planning 收口，
并明确保留 `selected_target` / `selectedTarget` 只表示 raw runtime target 的语义。

## What This Plan Closed

- 冻结并完成 `rag-agent` / `navigation-agent` 的 canonical current-truth runtime label 收口
- 收口 `packages/rag-agent`、`packages/navigation-agent` 与对应 Python distribution / module import truth
- 保持 `selected_target` / `selectedTarget` 继续只表示 raw runtime target，不混成 display label 或 capability-family-only field
- 收口 prompt / eval / observability / contract / architecture / ADR / planning 的 active canonical truth，不再把 `rag-agent` / `navigation-agent` 写成 planning-only alias
- 明确拒绝 compatibility shim、dual naming alias 与长期半迁移状态

## Current Canonical Entry

- `docs/architecture/current-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在 repo 重新 admission raw runtime target family rename、显式改写 `selected_target` / `selectedTarget` 语义，
或新增 capability family 需要重开 repo-wide naming / label convergence 规则时，才应恢复这条 workstream。
