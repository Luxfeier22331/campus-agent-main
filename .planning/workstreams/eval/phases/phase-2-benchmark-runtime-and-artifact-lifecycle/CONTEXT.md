---
doc_type: context
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 2 Context

## Why This Phase Exists

在 `Phase 1` 冻结 owner 之后，shared eval 仍存在一个实际债务：
runtime 已经是 shared 的，但 artifact / repair / accept 语义还散落在 handbook 语义和局部实现事实中。

## Repo Facts

- `packages/evals` 已具备 `run / repair / accept` 生命周期
- handbook / curriculum / official-web 已共用同一组 runtime 行为
- shared benchmark core 仍带 handbook 命名 debt

## Phase Output

本 phase 必须把 shared benchmark runtime 与 artifact lifecycle 收口成 neutral truth：

- neutral shared core
- shared artifact contract
- shared acceptance summary
- shared repair provenance

