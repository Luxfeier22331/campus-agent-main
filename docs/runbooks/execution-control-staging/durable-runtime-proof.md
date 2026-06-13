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
deployed `chat-staging -> app-api-staging -> execution-control -> Temporal workflow/activity`
reconnect evidence。`status-execution-control-staging.sh --check` 现在会显式拒绝
projection store 或 Temporal runtime 未 ready 的 execution-control readyz，也会拒绝
`api-staging /readyz` 中 `dependencies.executionRuntime` 不是 `ready` 的状态。该 gate 只防止
readiness 假绿；`pnpm --dir apps/app-api chat:durable:e2e:staging` 仍必须通过，且
`request.accepted` 必须包含 durable `runId` 与 `runPhase`。

### Worker Autoscaler Dry-Run / Evidence-Only Apply

本轮 staging 不要求 autoscaler 真实扩缩容容器或 Pod。当前 repo-local proof 只证明它读取
Temporal task queue / downstream budget observation，并只写 desired replica /
ops-plane actuation evidence；真实基础设施扩缩容 closeout 等链路成熟后再接入。

准备 observation JSON，例如：

```json
{
  "environment": "staging",
  "generated_at": "2026-06-06T00:00:00Z",
  "queues": [
    {
      "name": "campus-agent.workflow",
      "role": "workflow",
      "pollers": 1,
      "backlog": 0,
      "schedule_to_start_ms": 0,
      "current_replicas": 1,
      "min_replicas": 1,
      "max_replicas": 3,
      "target_schedule_to_start_ms": 500
    },
    {
      "name": "campus-agent.activity.context",
      "role": "context",
      "pollers": 1,
      "backlog": 0,
      "schedule_to_start_ms": 0,
      "current_replicas": 1,
      "min_replicas": 1,
      "max_replicas": 3,
      "target_schedule_to_start_ms": 500
    },
    {
      "name": "campus-agent.activity.knowledge",
      "role": "knowledge",
      "pollers": 1,
      "backlog": 0,
      "schedule_to_start_ms": 0,
      "current_replicas": 1,
      "min_replicas": 1,
      "max_replicas": 4,
      "target_schedule_to_start_ms": 500
    },
    {
      "name": "campus-agent.activity.finalization",
      "role": "finalization",
      "pollers": 1,
      "backlog": 0,
      "schedule_to_start_ms": 0,
      "current_replicas": 1,
      "min_replicas": 1,
      "max_replicas": 2,
      "target_schedule_to_start_ms": 500
    }
  ],
  "downstream_budgets": {
    "workflow": {"available": true, "max_replicas": 3},
    "rag": {"available": true, "max_replicas": 4},
    "finalization": {"available": true, "max_replicas": 2}
  }
}
```

运行 dry-run：

```bash
go run ./cmd/worker-autoscaler \
  --input-path "$evidence_dir/worker-autoscaler-input.json" \
  --evidence-path "$evidence_dir/worker-autoscaler-evidence.json"
```

可选本地 apply-mode evidence-only proof：

```bash
go run ./cmd/worker-autoscaler \
  --mode apply \
  --input-path "$evidence_dir/worker-autoscaler-input.json" \
  --evidence-path "$evidence_dir/worker-autoscaler-decision.json" \
  --actuator-evidence-path "$evidence_dir/worker-autoscaler-actuation.json"
```

通过标准：

- dry-run evidence `mode="dry_run"`；apply decision evidence `mode="apply"`
- `writes_execution_state=false`
- 每个 observed queue 都有 desired replica decision
- evidence 不包含 workflow/run/step/event/terminal state write 表述
- 该命令不得写 PG projection、Temporal workflow history 或 downstream budget
