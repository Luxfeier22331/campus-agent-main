---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---

# Temporal Queue 状态合同

## 文档边界

本文定义 Ops Web 获取当前 Temporal task queue 状态的内部只读接口。它不定义持久化
projection、自研 autoscaler、HPA 决策或 Temporal workflow history。

## 接口

`GET /internal/ops/temporal/task-queues`

- 所有者：`apps/execution-control`；
- 消费方：`apps/ops-web` 服务端；
- 认证：`Authorization: Bearer <metrics token>`；
- 超时：execution-control 的 Temporal 查询超时；
- 来源：Temporal SDK `DescribeTaskQueue` 或增强任务队列描述。

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

固定队列包括 workflow、core activity 和 agent activity。来源不支持某个指标时对应字段为
`null`，不能伪造为零。

## 缓存与持久化

- execution-control 每次请求读取 Temporal 当前状态，不写 PostgreSQL。
- Ops Web 进程内缓存成功结果 15 秒，避免首页刷新放大 Temporal 查询。
- 查询失败时可以显示该进程最近一次成功缓存；没有缓存时返回 unavailable/no data。
- 不存在 `operator.temporal_task_queue_current` 或 snapshot 表。

## 与 KEDA 的关系

KEDA Temporal scaler 直接读取 Temporal 队列并控制 Worker Controller 生成的
versioned Deployment。该内部接口只服务人工观测，不参与扩缩容决策，不写
actuation/posture 记录，也不能调用 Kubernetes API。

## 错误

- token 缺失或错误：`401`；
- Temporal client 未配置：`503 temporal_unavailable`；
- Temporal 查询失败或超时：`503 temporal_query_failed`。

## 可执行来源

- `apps/execution-control/internal/httpapi/temporal_task_queues.go`
- `apps/ops-web/src/server/temporal-task-queue-client.ts`
- `infra/k8s/execution-runtime/base/worker-resources.yaml`
