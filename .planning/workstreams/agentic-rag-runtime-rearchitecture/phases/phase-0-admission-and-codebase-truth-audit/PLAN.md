---
doc_type: plan
status: completed
created: 2026-05-04
updated: 2026-05-04
---

# Phase 0 Plan

## Objective

冻结 workstream 边界，并把当前 `rag-agent` 的真实实现形态映射成可规划的 phase
truth。

## Tasks

1. 创建 native workstream entry
2. 写入 requirements / roadmap / state
3. 审计当前 `rag-agent` 主路径与 heuristic 分布
4. 把下一阶段 planning 入口固定下来

## Verification

- `git diff --check`
- current codepath inventory
- docs / planning truth review

## Exit Criteria

- workstream 可被继续分 phase 规划
- 当前代码事实已足够支撑后续 Phase 1-5 设计
