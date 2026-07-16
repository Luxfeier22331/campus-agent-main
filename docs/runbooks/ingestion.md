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
  与 ingestion-control 使用同一个 `INGESTION_CONTROL_OPS_TOKEN` 合同。

本地迁移：

```bash
pnpm --filter ingestion-control migrate
```

容器 migration Job 直接调用 image 内 `tsx src/migrate.ts`，runtime container 不调用 pnpm 或
Corepack。migration 使用 transaction advisory lock，并在
`ingestion_control.schema_migrations` 保存 SQL 文件 SHA-256；修改已经应用的 migration 必须
失败，不能静默接管已有未登记表。

部署通过 `ingestion-schedule-sync` PostSync Job 对齐固定认证维护 Schedule。首次创建时保持
暂停；后续对齐只更新动作、策略和周期，保留现有暂停状态。本地需要验证该路径时显式运行：

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

先把 request document 写入 source bucket 并计算 SHA-256，再只提交 v3 envelope：

```bash
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version": "ingestion_task_envelope.v3",
    "task_id": "task-001",
    "run_id": "run-001",
    "registry_task_id": "official_web.capture",
    "input_ref": {
      "kind": "object_store",
      "uri": "s3://campus-agent-source/requests/run-001.json",
      "digest": "sha256:REPLACE_WITH_64_HEX_CHARACTERS"
    }
  }' \
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

## Kubernetes

```bash
kubectl kustomize infra/k8s/ingestion-runtime/base >/tmp/ingestion-runtime.yaml
kubeconform -strict -ignore-missing-schemas /tmp/ingestion-runtime.yaml
```

环境 overlay 必须提供：

- `ingestion-runtime-rendered-config`；
- 含数据库 URL、管理令牌和固定运维令牌的 `ingestion-control-secrets`；
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
- 内部门户凭据缺失或失效：替换固定 Secret 并恢复固定 Schedule，不修改任务载荷；
- source capture 失败：保留已写 artifact，修复后使用新 task ID。

## 验证

```bash
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:rust
```

staging capture 只用于环境或发布验证，不是普通本地实现检查。
