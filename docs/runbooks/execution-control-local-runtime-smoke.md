---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Execution Control Local Runtime Smoke

## 文档边界

这份 runbook 覆盖本地 `execution-control` Temporal runtime smoke。面向本地开发时优先使用
Docker compose runtime，因为当前 online answer path 需要 Temporal、run projection store、
workflow worker、RAG activity worker 与 finalization activity worker 同时存在。

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
- `activity-worker-context`
- `activity-worker-knowledge`
- `activity-worker-campus-services`
- `activity-worker-notice`
- `activity-worker-navigation`
- `activity-worker-finalization`
- `temporal`
- `run_projection_store`
- authenticated private data-plane dependencies such as Qdrant

Docker runtime smoke entry：

- [`infra/local/docker-compose.execution-control-runtime.yml`](../../infra/local/docker-compose.execution-control-runtime.yml)
- [`infra/local/start-execution-control-runtime.sh`](../../infra/local/start-execution-control-runtime.sh)

## Required Env

手动绕过启动脚本时，最小必填：

```bash
export API_WORKER_SHARED_SECRET=worker-secret
export EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE=true
export EXECUTION_CONTROL_TEMPORAL_ADDRESS=127.0.0.1:7233
export EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging
export EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=local:execution-control:001
export EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=local:workflow-worker:001
export EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY=local:activity-context:001
export EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY=local:activity-knowledge:001
export EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY=local:activity-campus-services:001
export EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY=local:activity-notice:001
export EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY=local:activity-navigation:001
export EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY=local:activity-finalization:001
export EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=local-workflow-salt
```

推荐本地 smoke 默认值：

```bash
export EXECUTION_CONTROL_DOCKER_GOPROXY=https://goproxy.cn,direct
export EXECUTION_CONTROL_DOCKER_GOSUMDB=sum.golang.org
export API_AUTH_MODE=trusted-worker
export AGENT_RUNTIME_PROVIDER=mock-runtime
export PROMPT_STRICT_STRUCTURED_OUTPUTS=true
export EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS=8
export EXECUTION_CONTROL_QUEUE_CAPACITY=24
export EXECUTION_CONTROL_QUEUE_TIMEOUT_MS=3000
export EXECUTION_CONTROL_LANE_RAG_MAX_CONCURRENT=6
export EXECUTION_CONTROL_LANE_RAG_QUEUE_CAPACITY=12
export EXECUTION_CONTROL_LANE_RAG_QUEUE_TIMEOUT_MS=3000
export EXECUTION_CONTROL_LANE_NAVIGATION_MAX_CONCURRENT=2
export EXECUTION_CONTROL_LANE_NAVIGATION_QUEUE_CAPACITY=4
export EXECUTION_CONTROL_LANE_NAVIGATION_QUEUE_TIMEOUT_MS=1500
export EXECUTION_CONTROL_OTEL_ENABLED=false
export EXECUTION_CONTROL_REQUEST_TIMEOUT_MS=45000
```

说明：

- 本地 smoke 必须配置 Temporal、projection store、Qdrant、embedding provider 与 prompt
  provider；缺任一时 `/readyz` 应 fail closed
- `EXECUTION_CONTROL_DOCKER_GOPROXY` 是 Go module proxy，不是 Docker registry mirror；本地默认可用
  `goproxy.cn` 缓解 `proxy.golang.org` TLS handshake timeout
- 不要把 `EXECUTION_CONTROL_DOCKER_GOSUMDB` 设为 `off`；保持 `sum.golang.org` 继续校验
  `go.sum`
- 如果没有配置真实 prompt runtime，`/readyz` 可能返回 `503 degraded`
- `503 degraded` 不阻塞 transport smoke，但必须在记录中解释原因

## Step 1. Docker Runtime Smoke

需要验证 Docker-first deploy substrate 时，先跑 deploy-side doctor gate：

```bash
uv run --all-packages python -m scripts.doctor_env execution-control --json
```

再启动本地 compose runtime：

```bash
infra/local/start-execution-control-runtime.sh
```

默认公开端口：

- `execution-control` -> `http://127.0.0.1:27051`

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
  "requested_capability": "knowledge",
  "selected_capability": "knowledge",
  "lane": "rag",
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
      "target": "rag-tool",
      "payload_kind": "rag_request",
      "allowed_tools": ["retrieval.query"],
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

## Step 5. Inspect Metrics And Logs

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

## Step 4. Shutdown

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
