---
doc_type: runbook
owner_boundary: apps/ingestion-control
status: active
---

# 采集运行

## 范围

本文说明 Temporal-backed ingestion API 和 worker 的操作。系统没有来源 callback、独立 run
ledger 或自动发布 query target，因此本文不描述这些路径。

## 前置条件

- ingestion migration job 可以访问 PostgreSQL；
- source 和 derived 使用独立凭据访问 S3-compatible object storage；
- Temporal namespace 可用；
- ingestion-control API/worker 与 source-collector image 来自同一 source revision；
- `configs/ingestion` 下 v3 registry 已通过校验；
- 目标来源所需 provider credential 已注入；
- 启用内部门户时，固定 `source-collector-internal-portal-auth` Secret 已初始化，且 Ops Web
  与 ingestion-control 使用同一个 `OPS_WEB_INTERNAL_TOKEN` 合同。

本地迁移：

```bash
pnpm --filter ingestion-control migrate
```

容器 migration Job 直接调用 image 内 `tsx src/migrate.ts`，runtime container 不调用 pnpm 或
Corepack。migration 使用 transaction advisory lock，并在
`ingestion_control.schema_migrations` 保存 SQL 文件 SHA-256；修改已经应用的 migration 必须
失败，不能静默接管已有未登记表。

部署通过 `ingestion-schedule-sync` PostSync Job 对齐两个固定计划：认证保活和通知发布。两者
均为 30 分钟周期，首次创建保持暂停；后续对齐只更新动作、策略和周期，保留现有暂停状态。
认证保活不提交采集任务，通知计划每次启动一个来源级父工作流。文件发布没有计划。

```bash
pnpm --filter ingestion-control schedules:sync
```

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

先把 request document 写入 source bucket 并计算 SHA-256，再将 v3 envelope 写入
`INGESTION_TASK_ENVELOPE_PATH` 指向的本地文件：

```bash
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

## 运维查询

```bash
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  http://127.0.0.1:8000/internal/ingestion/tasks/task-001

curl -fsS \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  'http://127.0.0.1:8000/internal/ingestion/operations/tasks?limit=50'

curl -fsS \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  http://127.0.0.1:8000/internal/ingestion/operations/internal-portal
```

workflow history、attempt、heartbeat、timeout 和 cancellation 使用 Temporal UI/CLI。PostgreSQL
只保存有界投影。

## 通知计划

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  -H "X-Operator-Id: operator@example.edu" \
  http://127.0.0.1:8000/internal/ingestion/operations/internal-portal/notice-publication/resume
```

暂停时把路径末尾改为 `/pause`。429/5xx 来源暂时故障记为 `deferred` 且不暂停计划；合同、
代码、检查点和完整性失败会暂停计划。凭据缺失或失效使用可由认证验证恢复的独立暂停原因。
`checkpoint_gap` 表示未在安全页数内找到上次发布头部，必须检查来源分页和现有检查点，不能
手工推进数据库值。

## 受控提交

立即完整核对必须给出独立请求 ID。它读取全部启用通知类型和分页，以来源当前集合核对发布
集合，不接受最大通知数，也不推进增量检查点：

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  -H "X-Operator-Id: operator@example.edu" \
  -H "Content-Type: application/json" \
  -d '{"request_id":"reconcile-20260717"}' \
  http://127.0.0.1:8000/internal/ingestion/operations/internal-portal/notice-publication/reconcile
```

文件发布只接受精确 ID，一次最多 50 个；每个 ID 建立独立父工作流：

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer ${OPS_WEB_INTERNAL_TOKEN}" \
  -H "X-Operator-Id: operator@example.edu" \
  -H "Content-Type: application/json" \
  -d '{"request_id":"files-20260717","file_release_ids":[646,647]}' \
  http://127.0.0.1:8000/internal/ingestion/operations/internal-portal/file-releases
```

系统不提供运行中任务取消接口。只有失败或已取消的独立任务可以在 Ops Web 重试；父工作流
子任务不能脱离父工作流单独重试。通知增量由下一计划周期重跑，通知完整核对和文件发布使用新的
请求 ID 重新提交完整来源级工作流。若 registry 合同已变化，独立任务重试也会返回冲突。

## Kubernetes

```bash
kubectl kustomize infra/k8s/ingestion-runtime/base >/tmp/ingestion-runtime.yaml
kubeconform -strict -ignore-missing-schemas /tmp/ingestion-runtime.yaml
```

环境 overlay 必须提供：

- `ingestion-runtime-rendered-config`；
- 含数据库 URL 和管理令牌的 `ingestion-control-secrets`；
- Ops Web 与 ingestion-control 共同消费的 `ops-web-internal-secrets`；
- 含不同来源与派生身份的 `object-store-secrets`；
- 启用内部门户时预创建的 `source-collector-internal-portal-auth`；
- 不可变 ingestion-control、worker 和 source-collector 镜像摘要；
- Temporal Connection、KEDA 补丁和 migration-before-runtime 同步顺序。

Secret 按凭据所有者和变更边界组织，不按 Pod 重复创建。workload 使用显式
`secretKeyRef`，不能用 Secret 级 `envFrom` 扩大权限。ingestion-control worker 可以获得
source/derived 对象存储凭据；source-collector 只能获得 source 凭据。

`source-collector-internal-portal-auth` 只包含 `sso_tgc`，以完整可选卷挂载。日常轮换通过
Ops Web 固定操作完成，不为每次轮换提交 SealedSecret；获取、校验和故障处理见
`portal-auth.md`。

所有 container 使用 non-root、read-only root filesystem 且不挂 service-account token。可写
状态只放 `emptyDir` 的 `/tmp`、Crawlee storage 和受限 `/dev/shm`；保留 `fsGroup` 以确保
非 root 用户可写新 volume。

## Worker 排查

```bash
kubectl get connection,workerdeployment,workerresourcetemplate
kubectl get deployment,scaledobject,poddisruptionbudget
kubectl describe workerdeployment ingestion-control-worker
kubectl describe workerdeployment source-collector-worker
```

依次检查：

1. Connection 健康状态和 Temporal namespace；
2. 目标与当前 build ID；
3. Worker 启动及两个版本变量；
4. WorkerResourceTemplate、ScaledObject 和 PDB；
5. Temporal poller 与 heartbeat；
6. 对象存储 digest；
7. 有界任务投影。

## 失败规则

- 缺少 registry/config/schema/credential：修复配置，不增加 fallback executor；
- digest 不一致：拒绝 task/artifact，不重新计算后接受；
- activity timeout：检查 heartbeat 和 provider/object-store latency，再决定新 task；
- 执行成功后 projection 暂时失败：让 Temporal retry control activity，不重复采集；
- result manifest、schema 或 frozen identity 不一致：以
  `invalid_ingestion_task_result` 失败，先修 producer；
- 内部门户凭据缺失或失效：通过 Ops Web 替换固定 Secret 并立即验证；成功后通知计划自动恢复，不修改任务载荷；
- `checkpoint_gap`：检查来源分页与发布流检查点，不更新检查点后伪装成功；
- 离线发布合同无效：保留来源和物化产物，只阻止该次发布；
- source capture 失败：保留已写 artifact，修复后使用新 task ID。

## 验证

```bash
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:rust
```

staging capture 只用于环境或发布验证，不是普通本地实现检查。
