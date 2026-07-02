---
doc_type: index
truth_scope: execution
owner_boundary: domains/execution
status: active
created: 2026-06-28
updated: 2026-06-28
---
# Execution Domain

## 先看什么

- durable runtime：`../architecture/system/durable-runtime.md`
- Execution Agent Layer：`../architecture/system/execution-agent-layer.md`
- 当前 merged truth：`../architecture/current.md`
- 通用执行态入口：`README.md`

## Architecture

- `../architecture/system/durable-runtime.md`
- `../architecture/system/execution-agent-layer.md`
- `../architecture/system/tool-routing.md`
- `../architecture/system/tool-runtime.md`
- `../architecture/system/k8s-runtime.md`
- `../architecture/system/runtime-release.md`
- `../architecture/system/ops-observability.md`

## Contracts And Data

- `../contracts/tool-execution.md`
- `../contracts/durable-runtime.md`
- `../data/durable-runtime.md`
- `../contracts/app-api/request-lifecycle.md`
- `../contracts/app-api/observability.md`

## Runbooks / Verification

- `../runbooks/temporal-self-host-operations.md`
- `../runbooks/local-runtime-smoke.md`
- `../runbooks/execution-ops.md`
- `../runbooks/execution-smoke.md`
- `../reference/testing-and-verification-lanes.md`

## 执行路由

- Temporal、durable run/event/step projection、worker plane、K8s/KEDA 与
  runtime release readiness 的 owner 分别是上面的 architecture / contract /
  runbook 文档。
- `Temporal` 是 execution substrate，不单独作为业务 domain hub。
