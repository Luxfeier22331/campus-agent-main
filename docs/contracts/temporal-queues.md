---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---

# Temporal 队列查询

## 边界

本文定义 Ops Web 服务端读取 Temporal task queue 当前状态的内部接口。它不定义 Ops Web 缓存、
持久执行投影、扩缩容决策或 Temporal workflow history。

可执行来源：

- `apps/execution-control/internal/httpapi/temporal_task_queues.go`；
- `apps/ops-web/src/server/temporal-task-queue-client.ts`。

## 接口

`GET /internal/ops/temporal/task-queues`

- 所有者：`apps/execution-control`；
- 调用方：`apps/ops-web` 服务端；
- 认证：`Authorization: Bearer <OPS_WEB_INTERNAL_TOKEN>`；
- 数据来源：Temporal SDK 的 task queue 描述接口。

成功响应：

```json
{
  "sampledAt": "2026-07-12T12:00:00Z",
  "queues": [
    {
      "name": "campus-agent.activity.agent",
      "type": "activity",
      "backlogCount": 3,
      "oldestTaskAgeSeconds": 2.5,
      "pollerCount": 2
    }
  ]
}
```

查询当前配置的 workflow queue，以及固定的 core activity 和 agent activity queue。来源不支持
backlog 或最久等待时间时，相应字段为 `null`，不能伪造为零；`pollerCount` 始终为非负整数。

## 错误

- token 缺失或错误：`401 unauthorized`；
- Temporal client 未配置：`503 temporal_unavailable`；
- Temporal 查询失败或超时：`503 temporal_query_failed`。

execution-control 每次请求实时查询，不写 PostgreSQL，也不返回旧数据。Ops Web 的查询超时、
进程内缓存和旧数据展示由 [ops-web/runtime.md](./ops-web/runtime.md) 定义。

## 扩缩容边界

该接口只服务人工诊断。KEDA Temporal scaler 直接读取 Temporal 并控制 Worker Controller 生成的
Deployment；本接口不参与副本决策，也不调用 Kubernetes API。
