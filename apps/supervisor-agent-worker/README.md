# campus-supervisor-agent-worker

`apps/supervisor-agent-worker` 是 Docker-first supervisor execution service 里的 Python
orchestration worker。

当前 public/internal HTTP execution ingress 已 hardcut 到 Go `apps/supervisor-api`。
本 package 不再暴露 public `/api/v1/answer`，也不再负责 bearer / trusted-worker
caller auth、public request body limit、transport admission、queue、metrics 或
published `transport_runtime`。Python ASGI 入口只保留 private bridge 的 defensive
body cap，避免异常 bridge caller 在 auth / JSON parsing 前造成无界内存占用。

## Responsibilities

Python worker 只负责：

- 接收 Go `supervisor-api` 已投影好的 private `SupervisorRequest`
- 装配默认 agent delegate map，并调用 worker 内部 private agent dispatcher
- 绑定 RAG prompt runtime / provider-backed executor
- 消费 Go bridge v6 中的 deterministic delegate handoff plan，并把完整
  `AgentRequest` 注入 agent dispatcher；不在 Python routing / framing 中重新构造
  RAG、navigation 或 structured payload
- 消费 Go bridge v6 中的 `routing_frame` / `scope_gate` / `policy_gate` /
  `context_preflight` / `handoff`；缺失 Go-owned routing frame 或 delegate handoff
  时 fail-closed
- 返回 agent 的 `AgentResponse`；Go `supervisor-api` 负责 public
  `SupervisorResponse` finalization 与 response observability projection
- 在配置 structured query internal seam 时，为 `campus-services-agent`
  注入 Go `supervisor-api` query service client
- 暴露 private bridge health / readiness
- 接收 Go `supervisor-api` 的 cooperative cancel signal，并在 Python bridge flag store
  中保留最小 cancel flag；默认 agent dispatch path 会在 prompt execution 和 agent
  delegation 前后检查取消状态

Python worker 不负责：

- browser-facing chat / panel API
- product-layer auth / session / conversation
- public execution transport
- Go `supervisor-api` admission / backpressure / metrics
- product scope、approval-required、query-enabled scope 或 context follow-up
  的 deterministic runtime truth
- terminal envelope、structured tool policy 或 deterministic structured runtime
  planner truth
- public `SupervisorResponse` finalization / response assembly / response
  observability truth
- deterministic runtime policy 或 public supervisor orchestration truth
- retrieval / ingestion data-plane ownership

## Private Bridge Surface

唯一支持的 HTTP routes 是：

- `POST /internal/bridge/supervisor/answer`
- `POST /internal/bridge/execution/cancel`
- `GET /internal/bridge/healthz`
- `GET /internal/bridge/readyz`

所有 bridge routes 都要求：

- `x-supervisor-bridge-auth: <secret>`
- `SUPERVISOR_AGENT_WORKER_SHARED_SECRET=<secret>`
- `SUPERVISOR_AGENT_WORKER_REQUEST_BODY_LIMIT_BYTES=1048576`，默认 1 MiB；该限制只
  作用于 private bridge body，不替代 Go `supervisor-api` 的 public ingress limit。

`/internal/bridge/readyz` 只报告 Python worker 自身状态：

- `prompt_runtime`
- `prompt_http_pool`
- `worker_runtime`

Go `supervisor-api` `/readyz` 会聚合 Python worker readiness，并发布唯一的
execution `transport_runtime`、lifecycle/cancel runtime truth 与
`prompt_config_gate`。

bridge answer route 只接受 `supervisor_bridge_v6` delegate handoff，并要求
`response_contract=agent_response`。请求必须携带
`runtime_decisions.handoff.agent_request`，且 routing frame 的
`suggested_next_action` 必须是 `delegate`。Non-delegate terminal routing 由 Go
`supervisor-api` 的 non-stream / lifecycle SSE direct terminal path 处理，不再发送给
Python bridge。`supervisor_bridge_v6` 之前的 shape、flat preplanned fields 与 legacy
handoff payload fragment 不是 active compatibility path。

这里的 `AgentRequest` / `AgentResponse` / `agent_response` /
`runtime_decisions.handoff.agent_request` 是 bridge v6 的 canonical private agent
handoff contract；worker 内部 active naming 使用 agent handoff、agent request 和
agent dispatch。

`/internal/bridge/execution/cancel` 记录 cooperative cancellation state。默认
Python agent dispatch 会在 delegate 调用与 prompt execution 前后的
checkpoints 停止并返回 `499 execution_cancelled`；如果 provider / prompt executor
已进入阻塞 HTTP 调用，当前仍不承诺 hard-abort 该 mid-flight provider request。

## Runtime Entry

Repo-local worker entry：

```bash
uv run --all-packages campus-supervisor-agent-worker-dev
```

默认监听：

```bash
SUPERVISOR_AGENT_WORKER_HOST=127.0.0.1
SUPERVISOR_AGENT_WORKER_PORT=18081
SUPERVISOR_AGENT_WORKER_THREADS=8
```

Docker image：

```bash
docker build -f apps/supervisor-agent-worker/Dockerfile \
  -t campus-supervisor-agent-worker:local .
```

完整本地 runtime 使用双容器：

```bash
docker compose -f infra/local/docker-compose.supervisor-runtime.yml up --build
```

## Prompt Env

```bash
export SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
export PROMPT_RUNTIME_PROVIDER=openai-responses
export PROMPT_RUNTIME_TRANSPORT=responses
export PROMPT_RUNTIME_MODEL=gpt-5.5
export SUPERVISOR_PROMPT_MODEL=
export AGENT_PROMPT_MODEL=
export PROMPT_STRICT_STRUCTURED_OUTPUTS=true
export PROMPT_RUNTIME_API_KEY=...
export PROMPT_RUNTIME_BASE_URL=https://api.openai.com/v1
export PROMPT_RUNTIME_REASONING_EFFORT=low
export PROMPT_RUNTIME_MAX_OUTPUT_TOKENS=512
export PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS=10
export PROMPT_RUNTIME_READ_TIMEOUT_SECONDS=30
export PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS=10
export PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS=3
export PROMPT_RUNTIME_MAX_CONNECTIONS=32
export PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS=16
export PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS=30
export SUPERVISOR_AGENT_WORKER_THREADS=8
export SUPERVISOR_STRUCTURED_QUERY_BASE_URL=http://supervisor-api:8000
export SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET=query-secret
export SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS=1
```

`PROMPT_RUNTIME_MODEL` 是 shared default。未显式提供 `SUPERVISOR_PROMPT_MODEL` /
`AGENT_PROMPT_MODEL` 时，两条角色链都会继承 `PROMPT_RUNTIME_MODEL`。

只有 provider、api key、agent model 与
`PROMPT_STRICT_STRUCTURED_OUTPUTS=true` 同时满足时，`prompt_runtime.admitted` 才会为
`true`。`SUPERVISOR_PROMPT_MODEL` 仍会在 readiness 中透传以保持配置可观测，但当前
supervisor terminal prompt stack 已移除，不再作为 Python worker admission 必需项。

Python bridge 不再拥有本地 supervisor audit JSONL writer，也不在 public handler
签名中暴露 `audit_sink`。execution audit 由 Go `apps/supervisor-api` 的 allowlisted
audit writer 负责回流到 `app-api` internal ingest。

`SUPERVISOR_STRUCTURED_QUERY_BASE_URL` / `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET`
只用于 Python worker 调用 Go `supervisor-api` 的 internal
`/internal/query/campus-services/*` seam。未配置时，`campus-services-agent`
继续保持 internal query service unavailable，不会打开产品 serving gate。
