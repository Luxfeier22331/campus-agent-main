---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Go-Shell Local Runtime Smoke

## 文档边界

这份 runbook 只覆盖本地 Docker-first `go-shell` supervisor runtime smoke。

它回答的是：

- 如何在本机启动 `go-shell + Python orchestration` 双容器 runtime
- 最小 health / ready / metrics / answer smoke 要怎么做
- 当前 accepted runback 路径是什么

它不负责：

- staging deploy
- Worker surface deploy
- `app-api` 产品层限流、stop UX 或请求生命周期

## Scope

当前 local runtime 形态固定为：

- `supervisor-shell`
  - Go execution shell
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`
  - `POST /api/v1/answer`
- `supervisor-orchestrator`
  - Python orchestration worker
  - `POST /internal/bridge/supervisor/answer`
  - `GET /internal/bridge/healthz`
  - `GET /internal/bridge/readyz`

compose entry：

- [`infra/local/docker-compose.supervisor-runtime.yml`](/home/reptilian/code/campus-agent/infra/local/docker-compose.supervisor-runtime.yml)
- [`infra/local/start-supervisor-runtime.sh`](/home/reptilian/code/campus-agent/infra/local/start-supervisor-runtime.sh)

## Required Env

本地 smoke 默认使用 `infra/local/start-supervisor-runtime.sh` 启动。它会先加载 repo root
`.env` 与 `apps/app-api/.dev.vars`，再把传入容器的
`DOCUMENT_REGISTRY_DATABASE_URL` / `CAMPUS_SHARED_POSTGRES_URL` 中的
`127.0.0.1` / `localhost` 改写为 `host.docker.internal`。

手动绕过启动脚本时，最小必填：

```bash
export SUPERVISOR_PY_BRIDGE_SHARED_SECRET=bridge-secret
export API_WORKER_SHARED_SECRET=worker-secret
```

推荐本地 smoke 默认值：

```bash
export API_AUTH_MODE=trusted-worker
export AGENT_RUNTIME_PROVIDER=mock-runtime
export PROMPT_STRICT_STRUCTURED_OUTPUTS=true
export SUPERVISOR_API_MAX_CONCURRENT_ANSWERS=8
export SUPERVISOR_API_QUEUE_CAPACITY=24
export SUPERVISOR_API_QUEUE_TIMEOUT_MS=3000
export SUPERVISOR_API_LANE_RAG_MAX_CONCURRENT=6
export SUPERVISOR_API_LANE_RAG_QUEUE_CAPACITY=12
export SUPERVISOR_API_LANE_RAG_QUEUE_TIMEOUT_MS=3000
export SUPERVISOR_API_LANE_NAVIGATION_MAX_CONCURRENT=2
export SUPERVISOR_API_LANE_NAVIGATION_QUEUE_CAPACITY=4
export SUPERVISOR_API_LANE_NAVIGATION_QUEUE_TIMEOUT_MS=1500
export SUPERVISOR_API_OTEL_ENABLED=false
export SUPERVISOR_API_REQUEST_TIMEOUT_MS=45000
```

说明：

- `mock-runtime` 允许当前 smoke 聚焦 transport / bridge / readiness，而不是 provider 凭据
- 如果没有配置真实 prompt runtime，`/readyz` 可能返回 `503 degraded`
- `503 degraded` 不阻塞 transport smoke，但必须在记录中解释原因

## Step 1. Start Runtime

```bash
infra/local/start-supervisor-runtime.sh
```

默认公开端口：

- `supervisor-shell` -> `http://127.0.0.1:18080`

## Step 2. Probe Health And Readiness

```bash
curl -sS http://127.0.0.1:18080/healthz
curl -sS http://127.0.0.1:18080/readyz
curl -sS http://127.0.0.1:18080/metrics
```

最小通过标准：

- `/healthz = 200`
- `/metrics = 200`
- `/readyz`
  - `200 ready`
  - 或 `503 degraded`，但 body 必须能解释是 bridge / prompt runtime /
    audit / transport 中哪一层未 ready

当前 `bridge_runtime` 额外暴露：

- `last_answer_failure_code`
- `last_answer_failure_at`
- `last_answer_success_at`

当前 `/metrics` 最小关注项：

- `campus_go_shell_requests_total`
- `campus_go_shell_request_duration_ms`
- `campus_go_shell_inflight_requests`
- `campus_go_shell_admission_decisions_total`
- `campus_go_shell_admission_lane_decisions_total`
- `campus_go_shell_admission_queue_depth`
- `campus_go_shell_admission_queue_wait_ms`
- `campus_go_shell_lifecycle_active_executions`
- `campus_go_shell_lifecycle_completed_total`
- `campus_go_shell_execution_audit_enabled`
- `campus_go_shell_execution_audit_configured`
- `campus_go_shell_execution_audit_emitted_total`
- `campus_go_shell_execution_audit_dropped_total`
- `campus_go_shell_execution_audit_failed_total`
- `campus_go_shell_telemetry_enabled`
- `campus_go_shell_bridge_duration_ms`
- `campus_go_shell_bridge_failures_total`

如果设置了 `SUPERVISOR_API_METRICS_BEARER_TOKEN`，拉取 `/metrics` 时必须带
`authorization: Bearer <token>`。本地默认不设置该 token。

`transport_runtime` 中的 `active_answers == max_concurrent_answers` 不单独代表
runtime 不健康；只要未 draining 且 admission queue 仍能接收短突发，`/readyz` 可以继续
返回 `200 ready`。队列满、draining 或 bridge 不健康才会让 readiness degraded。

## Step 3. Probe Answer Path

```bash
curl -sS -i \
  -H 'content-type: application/json' \
  -H 'x-worker-origin-auth: worker-secret' \
  -d @<(cat <<'JSON'
{
  "request_id": "req-local-smoke-001",
  "user_goal": "hello",
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
  http://127.0.0.1:18080/api/v1/answer
```

最小通过标准：

- 返回 typed JSON body
- 不是 transport-level unreachable / bridge failure
- 响应体包含 `status`
- 响应体包含 `trace_id`

如果当前 prompt runtime 未 admitted，typed outcome 仍可能是：

- `needs_clarification`
- `error`

这里只验证 execution shell / bridge / response contract，不把答案质量当成这份 smoke 的通过条件。

## Step 4. Inspect Metrics And Logs

再次拉取：

```bash
curl -sS http://127.0.0.1:18080/metrics
```

确认至少出现：

- `campus_go_shell_requests_total{route="/api/v1/answer",...}`
- `campus_go_shell_request_duration_ms_count{route="/api/v1/answer"}`
- `campus_go_shell_admission_lane_active{lane="rag"}`
- `campus_go_shell_lifecycle_active_executions`
- `campus_go_shell_telemetry_enabled`

Go shell 当前结构化日志最小字段：

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

关闭 Go shell 双容器 runtime：

```bash
infra/local/start-supervisor-runtime.sh down
```

## Evidence

建议最少记录：

- `healthz` body
- `readyz` body
- `/metrics` 关键片段
- 一条 answer request 的 `status`
- 一条 answer request 的 `trace_id`

建议落盘：

- `.tmp/go-shell-local-smoke/<timestamp>/healthz.json`
- `.tmp/go-shell-local-smoke/<timestamp>/readyz.json`
- `.tmp/go-shell-local-smoke/<timestamp>/metrics.txt`
- `.tmp/go-shell-local-smoke/<timestamp>/answer.json`
