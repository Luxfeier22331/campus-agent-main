---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Execution Control Local Runtime Smoke

## 文档边界

这份 runbook 覆盖本地 `execution-control` Temporal runtime smoke。面向本地开发时优先使用
Docker compose runtime，因为当前 online answer path 需要 Temporal、run projection store、
workflow worker、primary agent runtime/worker、RAG activity worker 与 finalization
activity worker 同时存在。

它回答的是：

- 如何在本机启动 `execution-control + Temporal + split workers`
- 最小 health / ready / metrics / execution run command smoke 要怎么做
- 当前 accepted runback 路径是什么

它不负责：

- staging deploy
- Worker surface deploy
- `app-api` 产品层限流、stop UX 或请求生命周期

## Scope

当前 local runtime 形态固定为：

- `execution-control`
  - Go-owned execution runtime
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`
  - `POST /internal/execution/runs`
  - `GET /internal/execution/runs/:runId`
  - `GET /internal/execution/runs/:runId/events`
  - `POST /internal/execution/runs/:runId/cancel`
- `workflow-worker`
- `activity-worker-core`
- `agent-runtime`
- `activity-worker-agent`
- `activity-worker-knowledge`
- `temporal`
- `run_projection_store`
- authenticated private data-plane dependencies such as Qdrant

Docker runtime smoke entry：

- [`infra/local/docker-compose.execution-control-runtime.yml`](../../infra/local/docker-compose.execution-control-runtime.yml)
- [`infra/local/docker-compose.execution-control-runtime.local.yml`](../../infra/local/docker-compose.execution-control-runtime.local.yml)
- [`infra/local/start-execution-control-runtime.sh`](../../infra/local/start-execution-control-runtime.sh)
- [`infra/local/docker-compose.qdrant-local.yml`](../../infra/local/docker-compose.qdrant-local.yml)

## Required Env

本地真实 provider 验证只需要先在 root `.env` 填外部 provider seed 输入：

```bash
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
EMBEDDING_BASE_URL=
EMBEDDING_API_KEY=
EMBEDDING_MODEL=Qwen3-Embedding-4B
EMBEDDING_DIMENSIONS=2560
```

可选 rerank 只在 runtime profile 启用 reranker 时填写：

```bash
RERANK_BASE_URL=https://ai.gitee.com/v1
RERANK_API_KEY=
RERANK_MODEL=
RERANK_PATH=/rerank
```

说明：

- 本地 smoke 必须配置 Temporal、projection store、agent-runtime、Qdrant、
  embedding provider 与 prompt provider；缺任一时 `/readyz` 或对应 activity
  应 fail closed
- 内部 secret、Hindsight secret、Qdrant admin/read-only key、Temporal password 与
  `EXECUTION_CONTROL_RUNTIME_RELEASE` 由 local lifecycle 生成/投影。不要把这些值手填到
  root `.env`
- `project-local-runtime-env.mjs --sync-app-api-dev-vars --format summary`
  只打印非敏感摘要，用于确认 root provider 输入和 generated runtime projection 是否可用
- admission budget、execution group budget、OTel 开关、request timeout、
  artifact path 与 open tools 都由 `EXECUTION_CONTROL_RUNTIME_CONFIG_PATH`
  指向的 runtime profile 管理，不再通过单项 env override
- `EXECUTION_CONTROL_DOCKER_GOPROXY` 是 Go module proxy，不是 Docker registry mirror；本地默认可用
  `goproxy.cn` 缓解 `proxy.golang.org` TLS handshake timeout
- 不要把 `EXECUTION_CONTROL_DOCKER_GOSUMDB` 设为 `off`；保持 `sum.golang.org` 继续校验
  `go.sum`
- 如果没有配置 app-api provider-config resolver，`/readyz` 可能返回 `503 degraded`
- `503 degraded` 不阻塞 transport smoke，但必须在记录中解释原因

## Step 1. Docker Runtime Smoke

推荐按固定顺序启动本地真实链路：

```bash
node infra/local/scripts/project-local-runtime-env.mjs \
  --sync-app-api-dev-vars --format summary
docker network inspect campus-agent-data-plane >/dev/null 2>&1 || \
  docker network create campus-agent-data-plane >/dev/null
docker compose -f infra/local/docker-compose.postgres.yml up -d postgres
infra/local/start-qdrant-local.sh up -d
node apps/app-api/scripts/run-with-local-env.mjs pnpm exec drizzle-kit migrate
node apps/app-api/scripts/run-with-local-env.mjs node \
  ./scripts/bootstrap-shared-product-with-seeds.mjs
```

另开一个终端启动 app-api：

```bash
pnpm --dir apps/app-api dev
```

写入 app-api provider-config active profiles：

```bash
node apps/app-api/scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/seed-local-provider-config.ts --stage prompt
infra/local/check-qdrant-local.sh
node apps/app-api/scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/seed-local-provider-config.ts --stage embedding
```

同步本地 provider projection artifact：

```bash
node scripts/sync-provider-config-projection.mjs \
  --output infra/local/.generated/provider-config-projection.json
```

如果启用 rerank：

```bash
node apps/app-api/scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/seed-local-provider-config.ts --stage rerank
```

启动 execution-control runtime：

```bash
EXECUTION_CONTROL_RUNTIME_FLAVOR=prodlike \
  infra/local/start-execution-control-runtime.sh up -d --build --remove-orphans
node infra/local/scripts/project-local-runtime-env.mjs \
  --sync-app-api-dev-vars --format summary
infra/local/check-qdrant-local.sh
curl -fsS http://127.0.0.1:27031/healthz >/dev/null
curl -fsS http://127.0.0.1:27051/healthz >/dev/null
curl -fsS http://127.0.0.1:27051/readyz >/dev/null
langfuse_health_url="http://127.0.0.1:${LANGFUSE_HOST_PORT:-3000}/api/public/health"
curl -fsS "${langfuse_health_url}?failIfDatabaseUnavailable=true" >/dev/null
```

默认公开端口：

- `execution-control` -> `http://127.0.0.1:27051`
- `app-api` -> `http://127.0.0.1:27031`
- `qdrant` -> `http://127.0.0.1:6333`

## Step 2. Probe Health And Readiness

```bash
curl -sS http://127.0.0.1:27051/healthz
curl -sS http://127.0.0.1:27051/readyz
curl -sS http://127.0.0.1:27051/metrics
```

启动后不要只等待 `/healthz`。`execution-control` 可能已经开始监听，但
Temporal poller、RAG lookup/synthesis 或 run projection store 仍未 ready；这时立即打
answer path 会得到真实 fail-closed 诊断。

正式发起 answer smoke 前，至少等待 `/readyz` 中：

- `temporal_runtime.healthy = true`
- `run_projection_store.healthy = true`
- `rag_runtime.lookup_healthy = true`
- `rag_runtime.synthesis_healthy = true`
- `prompt_config_gate.admitted = true`

`/readyz` 返回 `503 degraded` 时仍可继续轮询；只有 required runtime ready 后才进入 Step 3。

最小通过标准：

- `/healthz = 200`
- `/metrics = 200`
- `/readyz`
  - `200 ready`
  - 或 `503 degraded`，但 body 必须能解释是 Temporal / projection store /
    RAG runtime / prompt pricing / audit / transport 中哪一层未 ready

当前 `/metrics` 最小关注项：

- `campus_execution_control_requests_total`
- `campus_execution_control_request_duration_ms`
- `campus_execution_control_inflight_requests`
- `campus_execution_control_admission_decisions_total`
- `campus_execution_control_admission_lane_decisions_total`
- `campus_execution_control_admission_queue_depth`
- `campus_execution_control_admission_queue_wait_ms`
- `campus_execution_control_lifecycle_active_executions`
- `campus_execution_control_lifecycle_completed_total`
- `campus_execution_control_execution_audit_enabled`
- `campus_execution_control_execution_audit_configured`
- `campus_execution_control_execution_audit_emitted_total`
- `campus_execution_control_execution_audit_dropped_total`
- `campus_execution_control_execution_audit_failed_total`
- `campus_execution_control_telemetry_enabled`
- Temporal task queue / poller readiness and RAG activity evidence must be
  inspected from `/readyz` and smoke artifacts until a dedicated metric contract
  is promoted

如果设置了 `EXECUTION_CONTROL_METRICS_BEARER_TOKEN`，拉取 `/metrics` 时必须带
`authorization: Bearer <token>`。本地默认不设置该 token。

`transport_runtime` 中的 `active_answers == max_concurrent_answers` 不单独代表
runtime 不健康；只要未 draining 且 admission queue 仍能接收短突发，`/readyz` 可以继续
返回 `200 ready`。队列满、draining、Temporal / projection / RAG runtime 不健康才会让
readiness degraded。

## Step 3. Probe Answer Path

推荐直接用固定 smoke profile，自动落盘 artifact：

```bash
infra/local/smoke-execution-control-runtime.sh closed_gate
```

默认 artifact 路径：

```bash
.tmp/execution-control-local-smoke/<timestamp>-closed_gate/
```

手动 execution run probe 仍可保留为补充诊断：

```bash
curl -sS -i \
  -H 'content-type: application/json' \
  -H 'x-worker-origin-auth: worker-secret' \
  -d @<(cat <<'JSON'
{
  "run_id": "req-local-smoke-001",
  "conversation_id": "conv-local-smoke-001",
  "turn_id": "turn-local-smoke-001",
  "request_id": "req-local-smoke-001",
  "trace_id": "trace-local-smoke-001",
  "owner_user_id": "student-001",
  "surface": "local-smoke",
  "requested_tool": "knowledge_query",
  "selected_tool": "knowledge_query",
  "execution_group": "rag",
  "runtime_versions": {
    "contract": "temporal-execution-control-v1"
  },
  "user_goal": "hello",
  "metadata": {
    "execution_payload": {
      "user_goal": "hello",
      "request_id": "req-local-smoke-001",
      "conversation_id": "conv-local-smoke-001",
      "trace": {
        "trace_id": "trace-local-smoke-001"
      },
      "runtime_decisions": {
        "runtime_decision_summary": {}
      }
    },
    "handoff": {
      "target": "knowledge_query",
      "payload_kind": "rag_request",
      "allowed_tools": ["knowledge_query"],
      "payload": {
        "query_text": "hello"
      }
    }
  },
  "context": {
    "actor": {
      "user_id": "student-001"
    },
    "authorization": {
      "retrieval_filter": {
        "entitlement_groups": [],
        "visibility_level": "public",
        "policy_projection_version": "phase1-authorization-projection-v1"
      }
    }
  }
}
JSON
) \
  http://127.0.0.1:27051/internal/execution/runs
```

最小通过标准：

- 返回 `202`
- 响应体包含 `run_id`
- 响应体包含 `status=queued`
- 不出现 retired legacy answer transport fallback

## Step 4. Inspect Metrics And Logs

再次拉取：

```bash
curl -sS http://127.0.0.1:27051/metrics
```

确认至少出现：

- `campus_execution_control_requests_total{route="/internal/execution/runs",...}`
- `campus_execution_control_request_duration_ms_count{route="/internal/execution/runs"}`
- `campus_execution_control_admission_lane_active{lane="rag"}`
- `campus_execution_control_lifecycle_active_executions`
- `campus_execution_control_telemetry_enabled`

Go `apps/execution-control` 当前结构化日志最小字段：

- `route`
- `trace_id`
- `status_code`
- `outcome`
- `duration_ms`

固定约束：

- 不记录 raw `user_goal`
- 不记录 raw auth secret
- 不记录 raw request body

## Step 5. Shutdown

关闭 execution-control compose runtime：

```bash
infra/local/start-execution-control-runtime.sh down
```

## Evidence

建议最少记录：

- `healthz` body
- `readyz` body
- `/metrics` 关键片段
- 一条 answer request 的 `status`
- 一条 answer request 的 `trace_id`

建议落盘：

- `.tmp/execution-control-local-smoke/<timestamp>-<profile>/healthz.json`
- `.tmp/execution-control-local-smoke/<timestamp>-<profile>/readyz.json`
- `.tmp/execution-control-local-smoke/<timestamp>-<profile>/metrics.txt`
- `.tmp/execution-control-local-smoke/<timestamp>-<profile>/answer.json`
- `.tmp/execution-control-local-smoke/<timestamp>-<profile>/summary.json`
