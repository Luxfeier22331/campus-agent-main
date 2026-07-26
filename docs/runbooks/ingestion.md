---
doc_type: runbook
owner_boundary: apps/ingestion-control
status: active
---

# 采集运行

## 当前边界

仓库保留 ingestion-control、source-collector、合同和本地验证能力，但 staging 当前不部署 ingestion
Application、worker、schedule 或来源凭据。Ops Web 不提供采集任务、通知计划或门户认证接口。
源码中的 Kubernetes base 是实现输入，不表示环境已经启用该运行时。

## 本地前置条件

- source 和 derived bucket 的 S3-compatible 连接；
- 可用的 Temporal namespace；
- 本地 PostgreSQL 与 ingestion schema owner/runtime 连接；
- `configs/ingestion` v3 registry；
- 目标来源明确需要的凭据。

本地迁移：

```bash
pnpm --filter ingestion-control schema:bootstrap
pnpm --filter ingestion-control migrate
```

正式连接要求 `verify-full` 和 CA 文件。本地明文 PostgreSQL 必须同时显式设置
`DEPLOYMENT_ENVIRONMENT=local` 与 `INGESTION_CONTROL_DATABASE_SSLMODE=disable`。

## 本地启动

使用 `env/commands/ingestion-control-runtime.env.example` 准备变量，然后运行：

```bash
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

本地 worker 不设置 `TEMPORAL_DEPLOYMENT_NAME` 和 `TEMPORAL_WORKER_BUILD_ID`。

## 提交与查询

先将 request document 写入 source bucket 并计算 SHA-256，再提交 v3 envelope：

```bash
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary "@${INGESTION_TASK_ENVELOPE_PATH}" \
  http://127.0.0.1:8000/internal/ingestion/tasks

curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  http://127.0.0.1:8000/internal/ingestion/tasks/task-001
```

`202` 表示 Temporal 接受 workflow，或相同 workflow 仍在运行。canonical workflow ID 为
`ingestion/<task_id>`。只有冻结请求完全一致时才幂等；新的执行使用新 task ID。workflow history、
attempt、heartbeat、timeout 和 cancellation 使用 Temporal UI/CLI，PostgreSQL 只保存有界投影。

## 失败规则

- 缺少 registry、schema 或 credential：修复所属输入，不增加 fallback executor；
- digest 或 frozen identity 不一致：拒绝任务或产物；
- activity timeout：检查 heartbeat 与来源/对象存储延迟后使用新 task；
- projection 暂时失败：让 Temporal 重试 control activity，不重复采集；
- 来源采集失败：保留已经写入的 artifact，修复后使用新 task ID。

## 验证

```bash
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:ingestion-control-postgres
pnpm ci:rust
```

PostgreSQL 套件使用隔离 Testcontainers，只在显式 database profile 运行。真实来源与环境部署验证
不属于普通本地检查。
