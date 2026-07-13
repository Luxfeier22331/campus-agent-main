---
doc_type: runbook
truth_scope: ops
owner_boundary: temporal
status: active
created: 2026-04-19
updated: 2026-07-12
---

# Temporal Operations

## 范围

本文说明自托管 Temporal 的日常检查、worker queue 和 KEDA 故障定位。它不定义产品请求
状态、发布验收循环或一次性 staging closeout。

## 权威来源

- workflow history、retry、timeout、cancel、Signal/Update：Temporal；
- run/event/step/tool projection：execution-control PostgreSQL；
- worker replica：KEDA/HPA 和 Kubernetes Deployment status；
- 人工队列摘要：execution-control 内部 Temporal queue endpoint；
- logs/metrics/traces：OpenTelemetry/OpenObserve。

不要从 app-api projection、telemetry 或 chat transcript 重建 Temporal history。

## Namespace

确认 namespace 已注册且 retention 符合环境策略：

```bash
temporal operator namespace describe \
  --address "$EXECUTION_CONTROL_TEMPORAL_ADDRESS" \
  --namespace "$EXECUTION_CONTROL_TEMPORAL_NAMESPACE"
```

namespace bootstrap 由环境平台管理，不由 worker 启动时隐式创建。

## Worker Pollers

固定队列：

- `campus-agent.workflow`
- `campus-agent.activity.core`
- `campus-agent.activity.agent`

检查 execution-control readiness：

```bash
curl -fsS "$EXECUTION_CONTROL_INTERNAL_BASE_URL/readyz" \
  -H "x-internal-shared-secret: $EXECUTION_CONTROL_SHARED_SECRET"
```

`temporal_runtime.task_queue_pollers` 必须包含三个队列。Temporal 的 recent poller 窗口不是
永久注册表；Deployment rollout 时允许短暂波动，但持续为零表示 worker 不可用。

## Ops Web 队列接口

```bash
curl -fsS "$EXECUTION_CONTROL_INTERNAL_BASE_URL/internal/ops/temporal/task-queues" \
  -H "authorization: Bearer $EXECUTION_CONTROL_METRICS_BEARER_TOKEN"
```

响应展示 backlog、oldest task age 和 poller count。某个 Temporal source 不支持的指标为
`null`，不是零。该结果不落 PostgreSQL，并在 Ops Web 进程内缓存 15 秒。

## KEDA/HPA

每个 worker pool 必须恰好有一个 ScaledObject 和一个生成的 HPA：

```bash
kubectl -n "$NAMESPACE" get scaledobject,hpa,deploy \
  -l app.kubernetes.io/part-of=campus-agent
```

检查：

- ScaledObject `Ready=True`、`Active` 与 backlog 一致；
- HPA 没有持续 metric fetch error；
- target Deployment 是对应 queue 的唯一 poller owner；
- replica 在 0..3 范围；
- scale down 遵守 300 秒 stabilization；
- 长 activity 没有因缩容被强制中断。

KEDA 直接读取 Temporal。不要启动 temporal sampler、posture collector、Docker autoscaler，
也不要手工写 queue/decision/actuation 表。

## 常见故障

### Queue 有积压但副本为零

1. 检查 KEDA operator 和 metrics API；
2. 检查 scaler endpoint、namespace、taskQueue 和 queueTypes；
3. 检查 Temporal 网络和认证；
4. 检查 HPA condition 和 Deployment scheduling event。

### 有副本但 poller 为零

1. 检查 Pod readiness 和 worker command；
2. 检查 queue 名称与 runtime config；
3. 检查 Temporal namespace 和连接；
4. 检查 worker 日志中的 registration/start failure。

### 队列接口不可用

1. 检查 metrics bearer token；
2. 检查 execution-control Temporal client；
3. 直接使用 Temporal CLI/UI 验证 source；
4. 不通过写数据库快照绕过故障。

## Persistence

Temporal persistence 和 visibility 数据库由 Temporal platform application 管理。备份、恢复、
schema upgrade 和 retention 必须使用 Temporal/CNPG 对应 runbook，不与 `campus_agent` 产品
schema installer 混用。

## 变更验证

配置或 worker 变更至少执行：

1. Kustomize render 和 schema 校验；
2. execution-control Go tests；
3. 三个 Deployment/ScaledObject owner 对齐检查；
4. readiness 和 queue endpoint 检查；
5. 一个可取消的测试 workflow，确认 terminal projection 不漂移。

仅修改文档或本地代码时不需要反复执行 staging release closeout。
