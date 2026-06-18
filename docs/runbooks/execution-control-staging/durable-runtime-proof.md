---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-13
updated: 2026-06-13
---

# Execution Control Staging Durable Runtime Proof

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## Durable Runtime Proof

先运行 durable cutover preflight。该命令只读取
`EXECUTION_CONTROL_STAGING_ENV_FILE` 指向的 ops-owned runtime env 和当前 process env，
不部署、不写远端状态、不打印 secret value；缺 `STAGING_INGESTION_*` 数据面配置、
execution-control shared secret 或 Cloudflare deploy token 时必须 fail closed：

```bash
pnpm durable:cutover:preflight --json
```

`CLOUDFLARE_API_TOKEN` 是本次 deploy shell 的 process env，不写入 repo checkout。
如果在 `nc-arm-6c` 的非登录 SSH shell 中运行，必须先确认
`pnpm` 与 `uv` 都能被找到；当前 host 可用路径为 `/usr/local/bin/pnpm` 与
`/home/deploy/.local/bin/uv`，必要时用以下方式显式执行：

```bash
PATH=/home/deploy/.local/bin:/usr/local/bin:/usr/bin:/bin \
  pnpm durable:cutover:preflight --json
```

先确认 schema install/check evidence 存在，且两份 JSON 都报告 `passed=true`、
`schema_ready=true`、`store=postgres`。schema evidence 来自启动脚本，不来自 proof：

```bash
jq . .tmp/execution-control-staging/evidence/run-projection-schema-install.json
jq . .tmp/execution-control-staging/evidence/run-projection-schema-check.json
```

在把 Temporal execution runtime 标记为 staging-ready 前，对当前 deployed
execution-control HTTP runtime 运行 repo-owned Temporal-ready proof。该命令
只读取 `/readyz`，并要求 deployed payload 明确报告 projection store healthy、Temporal runtime
healthy：

```bash
execution_control_url="${STAGING_EXECUTION_CONTROL_BASE_URL:-http://127.0.0.1:27051}"
go run ./cmd/temporal-runtime-http-proof \
  --execution-control-url "$execution_control_url" \
  --shared-secret "$EXECUTION_CONTROL_SHARED_SECRET" \
  --evidence-path "$evidence_dir/execution-control-temporal-http-proof.json"
```

如果 machine ingress / app-api public deploy token 暂不可用，但需要先证明隔离目录中
本机 execution control runtime 已经具备 projection store、Temporal workers 与 container
data-plane readiness，可运行 local Temporal proof：

```bash
infra/local/staging/proof-execution-control-temporal-runtime-staging.sh
```

该 proof 不检查 machine ingress、`api-staging.mucwiki-edge.link/readyz` 或 browser
reconnect；它只能作为 execution runtime substrate evidence，不能替代
`status-execution-control-staging.sh --check` 或
`pnpm --dir apps/app-api chat:durable:e2e:staging`。

通过标准：

- `passed=true`
- HTTP proof 的 `readyz.run_projection_store.configured=true`
- HTTP proof 的 `readyz.run_projection_store.healthy=true`
- HTTP proof 的 `readyz.temporal_runtime.configured=true`
- HTTP proof 的 `readyz.temporal_runtime.healthy=true`

该 proof 只证明 projection store / Temporal runtime 的生产不变量；它不能安装 schema，也不能替代真实
deployed `campus-staging -> app-api-staging -> execution-control -> Temporal workflow/activity`
reconnect evidence。`status-execution-control-staging.sh --check` 现在会显式拒绝
projection store 或 Temporal runtime 未 ready 的 execution-control readyz，也会拒绝
`api-staging /readyz` 中 `dependencies.executionRuntime` 不是 `ready` 的状态。该 gate 只防止
readiness 假绿；`pnpm --dir apps/app-api chat:durable:e2e:staging` 仍必须通过，且
`request.accepted` 必须包含 durable `runId` 与 `runPhase`。

### Worker Autoscaler Projection / Apply Proof

autoscaler proof 使用真实 app-api operator runtime projection，不再使用本地
`autoscaler-input.json`。执行顺序固定为：

1. `temporal-task-queue-sampler` 从 Temporal
   `DescribeTaskQueue(report_stats=true)` 采样并发布 task queue snapshot 到
   app-api。
2. `worker-autoscaler` 从 app-api internal runtime query 读取最新 snapshot。
3. `worker-autoscaler` 从 Docker Compose 读取 allowlisted worker replica state。
4. dry-run 发布 decision projection；apply mode 通过 Docker Compose actuator 调整
   allowlisted service replica，并发布 actuation projection。

运行 sampler：

```bash
cd apps/execution-control
go run ./cmd/temporal-task-queue-sampler \
  --temporal-address "$EXECUTION_CONTROL_TEMPORAL_ADDRESS" \
  --temporal-namespace "$EXECUTION_CONTROL_TEMPORAL_NAMESPACE" \
  --workflow-task-queue "${EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE:-campus-agent.workflow}" \
  --app-api-base-url "$EXECUTION_CONTROL_APP_API_BASE_URL" \
  --shared-secret "$EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET"
```

运行 dry-run：

```bash
go run ./cmd/worker-autoscaler \
  --mode dry-run \
  --app-api-base-url "$EXECUTION_CONTROL_APP_API_BASE_URL" \
  --shared-secret "$EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET" \
  --compose-project-name "$EXECUTION_CONTROL_COMPOSE_PROJECT_NAME" \
  --compose-project-directory "$EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY"
```

可选 apply mode：

```bash
go run ./cmd/worker-autoscaler \
  --mode apply \
  --app-api-base-url "$EXECUTION_CONTROL_APP_API_BASE_URL" \
  --shared-secret "$EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET" \
  --compose-project-name "$EXECUTION_CONTROL_COMPOSE_PROJECT_NAME" \
  --compose-project-directory "$EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY"
```

通过标准：

- app-api `GET /api/operator/runtime/temporal-task-queues` 可见 sampler snapshot
- app-api `GET /api/operator/runtime/autoscaler/decisions` 可见每个 service 的 desired
  replica decision
- app-api `GET /api/operator/runtime/autoscaler/actuations` 可见 apply-mode actuation
  evidence
- backlog 与 oldest task age 在当前 sampler 下必须是 observed Temporal stats；
  schedule-to-start latency 必须显式为 `unsupported_by_source`
- apply mode 只允许 contract 中列出的 Docker Compose worker service
- 该命令不得写 PG projection、Temporal workflow history 或 downstream budget
