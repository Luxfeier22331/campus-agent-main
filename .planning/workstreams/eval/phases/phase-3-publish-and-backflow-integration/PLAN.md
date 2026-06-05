---
doc_type: phase_plan
phase: "3"
phase_name: "Publish And Backflow Integration"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 3 Plan

## Objective

让 accepted eval artifact 能通过 shared seam 稳定进入 `app-api`，同时保持 `app-api` 仍是 operator truth owner。

## Execution Slices

### Slice 1: Freeze App API Eval Ingress

- 固定 `POST /api/internal/evals/chat/requests`
- 固定 `surface = eval_benchmark`
- 固定 canonical `requestId` / `traceId`

### Slice 2: Freeze Publish / Backflow Contract

- inline `request_correlation` 优先
- 外部 manifest 只能作为显式 publish input；缺失 inline correlation 时 fail closed
- publish summary 只记录结果，不反向定义 accepted verdict

### Slice 3: Freeze Ownership Boundary

- eval 拥有 artifact / publish input truth
- `app-api` 拥有 ingest validation、durable truth 与 query/read-model

## Exit Rule

完成后，publish/backflow 已成为 accepted shared seam，而不是 handbook/curriculum 局部 closeout 逻辑。
