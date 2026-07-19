---
doc_type: runbook
owner_boundary: apps/ingestion-control
status: active
---

# 采集运行

## 范围

本文说明 ingestion-control API、Temporal worker 和来源 worker 的本地操作与故障处理。采集
完成不会自动发布在线知识目标。

## 前置条件

- ingestion migration job 可以访问 PostgreSQL；
- source 和 derived 使用独立凭据访问 S3-compatible object storage；
- Temporal namespace 可用；
- ingestion-control API/worker 与 source-collector image 来自同一 source revision；
- `configs/ingestion` 下 v3 registry 已通过校验；
- 目标来源所需 provider credential 已注入；
- 启用内部门户时，固定 `source-collector-internal-portal-auth` Secret 已初始化，且 Ops Web
  与 ingestion-control 使用同一个 `INGESTION_CONTROL_OPS_TOKEN` 合同。

本地迁移：

```bash
pnpm --filter ingestion-control migrate
```

迁移的执行入口、顺序和镜像版本由 Kubernetes base 与环境仓维护。内部门户认证维护操作见
[内部门户认证](./portal-auth.md)，不在通用采集手册复制 Schedule 资源细节。

## 本地启动

使用 `env/commands/ingestion-control-runtime.env.example` 明确准备本地变量，在独立 shell
启动：

```bash
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

本地 worker 不设置 `TEMPORAL_DEPLOYMENT_NAME` 和 `TEMPORAL_WORKER_BUILD_ID`；生产由 Worker
Controller 注入。

```bash
curl -fsS http://127.0.0.1:8000/healthz
curl -fsS http://127.0.0.1:8000/readyz
```

## 提交 Task

请求结构以
[`task-envelope.valid.json`](../../packages/ingestion-contracts/assertions/task-envelope.valid.json)
为准。提交前为本次任务生成新的 `task_id`、`run_id`，把输入对象写入对应 bucket，并填写真实的
URI、字节数和 SHA-256；不要直接提交 fixture 中的示例标识。

```bash
export INGESTION_TASK_ENVELOPE_PATH=.tmp/ingestion-task-envelope.json
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@${INGESTION_TASK_ENVELOPE_PATH}" \
  http://127.0.0.1:8000/internal/ingestion/tasks
```

`202` 表示 Temporal 接受 workflow，或相同 workflow 仍在运行。canonical workflow ID 为
`ingestion/<task_id>`。只有 `run_id`、`registry_task_id` 和 `input_ref` 与冻结请求一致时
才幂等；不一致返回 `409 ingestion_task_conflict`。新的执行使用新 task ID。

已关闭 workflow 若缺少 PostgreSQL projection，返回 `409 ingestion_projection_missing`，
不得伪装成再次接受。

## 查询

```bash
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  http://127.0.0.1:8000/internal/ingestion/tasks/task-001

curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_APP_API_PROJECTION_TOKEN}" \
  'http://127.0.0.1:8000/internal/ingestion/operator-projection/tasks?limit=50'
```

workflow history、attempt、heartbeat、timeout 和 cancellation 使用 Temporal UI/CLI。PostgreSQL
只保存有界投影。

## 取消

```bash
temporal workflow cancel \
  --address "${INGESTION_TEMPORAL_ADDRESS}" \
  --namespace "${INGESTION_TEMPORAL_NAMESPACE}" \
  --workflow-id ingestion/task-001
```

系统没有来源专用 cancel route。workflow 取消 active activity，并通过 non-cancellable cleanup
写 `canceled` 投影；executor result 已被接受后，晚到 cancel 不得覆盖 completed projection。
不得手工修改 PostgreSQL 行。

## 部署与 Worker 排查

源码仓的 Kubernetes base 位于 `infra/k8s/ingestion-runtime/base`；实际环境的镜像、配置、Secret、
网络和控制器资源由环境仓维护。不要在本手册保存环境资源清单。

排查时依次确认 Temporal 连接与 poller、worker 当前版本、activity heartbeat、对象存储 digest 和
有界任务投影。工作流历史、重试与取消以 Temporal 为准；部署与扩缩容状态以环境仓和集群控制器
为准。内部门户凭据问题按 [内部门户认证](./portal-auth.md) 处理。

## 失败规则

- 缺少 registry、配置、schema 或凭据：修复对应输入，不增加隐式替代执行器；
- digest 不一致：拒绝 task/artifact，不重新计算后接受；
- activity timeout：检查 heartbeat 和 provider/object-store latency，再决定新 task；
- 执行成功后 projection 暂时失败：让 Temporal retry control activity，不重复采集；
- result manifest、schema 或 frozen identity 不一致：以
  `invalid_ingestion_task_result` 失败，先修 producer；
- 内部门户凭据缺失或失效：替换固定 Secret 并恢复固定 Schedule，不修改任务载荷；
- source capture 失败：保留已写 artifact，修复后使用新 task ID。

## 验证

```bash
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:rust
```

staging capture 只用于环境或发布验证，不是普通本地实现检查。
