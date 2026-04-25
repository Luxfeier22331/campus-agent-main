# campus-supervisor-core-worker

`apps/supervisor-core-worker` 是 Docker-first supervisor execution service 里的 Python
orchestration worker。

当前 public/internal HTTP execution ingress 已 hardcut 到 Go `apps/supervisor-api`。
本 package 不再暴露 public `/api/v1/answer`，也不再负责 bearer / trusted-worker
caller auth、request body limit、transport admission、queue、metrics 或 published
`transport_runtime`。

## Responsibilities

Python worker 只负责：

- 接收 Go `supervisor-api` 已投影好的 private `SupervisorRequest`
- 调用 `packages/supervisor-core`
- 绑定 prompt runtime / provider-backed executors
- 消费 Go bridge v3 中的 deterministic delegate handoff plan，并把它注入
  supervisor-core；不在 Python routing / framing 中重新构造 RAG、navigation 或
  structured payload
- 消费 Go bridge v3 中的 `routing_frame` / `scope_gate` / `policy_gate` /
  `context_preflight` / `terminal_envelope` / `handoff`；缺失 Go-owned routing
  frame、terminal envelope 或 delegate handoff 时 fail-closed
- 消费 Go bridge v3 中的 terminal response envelope；不在 Python worker /
  supervisor-core 中重新调用 prompt executor 合成 deterministic terminal 文案
- 在配置 structured query internal seam 时，为 `campus-services-agent`
  注入 Go `supervisor-api` query service client
- 暴露 private bridge health / readiness
- 接收 Go `supervisor-api` 的 cooperative cancel signal，并在 Python bridge registry
  中保留最小 cancel flag；默认 supervisor orchestration 会在路由、prompt
  composition、specialist delegation 和 finalization 前后检查取消状态

Python worker 不负责：

- browser-facing chat / panel API
- product-layer auth / session / conversation
- public execution transport
- Go `supervisor-api` admission / backpressure / metrics
- product scope、approval-required、query-enabled scope 或 context follow-up
  的 deterministic runtime truth
- terminal envelope、structured tool policy 或 deterministic structured runtime
  planner truth
- retrieval / ingestion data-plane ownership

## Private Bridge Surface

唯一支持的 HTTP routes 是：

- `POST /internal/bridge/supervisor/answer`
- `POST /internal/bridge/execution/cancel`
- `GET /internal/bridge/healthz`
- `GET /internal/bridge/readyz`

所有 bridge routes 都要求：

- `x-supervisor-bridge-auth: <secret>`
- `SUPERVISOR_CORE_WORKER_SHARED_SECRET=<secret>`

`/internal/bridge/readyz` 只报告 Python worker 自身状态：

- `prompt_runtime`
- `prompt_http_pool`
- `worker_runtime`

Go `supervisor-api` `/readyz` 会聚合 Python worker readiness，并发布唯一的
execution `transport_runtime`、lifecycle/cancel runtime truth 与
`prompt_config_gate`。

bridge answer route 只接受 `supervisor_bridge_v3`。delegate routing 必须携带
`runtime_decisions.handoff`；non-delegate routing 必须携带
`runtime_decisions.terminal_envelope`。`supervisor_bridge_v3` 之前的 shape 和 flat
preplanned fields 不是 active compatibility path。

`/internal/bridge/execution/cancel` 记录 cooperative cancellation state。默认
Python semantic orchestration 会在 deterministic checkpoints 停止并返回
`499 execution_cancelled`；如果 provider / prompt executor 已进入阻塞 HTTP 调用，当前仍不承诺
hard-abort 该 mid-flight provider request。

## Runtime Entry

Repo-local worker entry：

```bash
uv run --all-packages campus-supervisor-core-worker-dev
```

默认监听：

```bash
SUPERVISOR_CORE_WORKER_HOST=127.0.0.1
SUPERVISOR_CORE_WORKER_PORT=18081
SUPERVISOR_CORE_WORKER_THREADS=8
```

Docker image：

```bash
docker build -f apps/supervisor-core-worker/Dockerfile \
  -t campus-supervisor-core-worker:local .
```

完整本地 runtime 使用双容器：

```bash
docker compose -f infra/local/docker-compose.supervisor-runtime.yml up --build
```

## Prompt Env

```bash
export SUPERVISOR_CORE_WORKER_SHARED_SECRET=bridge-secret
export PROMPT_RUNTIME_PROVIDER=openai-responses
export PROMPT_RUNTIME_TRANSPORT=responses
export PROMPT_RUNTIME_MODEL=gpt-5.5
export SUPERVISOR_PROMPT_MODEL=
export SPECIALIST_PROMPT_MODEL=
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
export SUPERVISOR_CORE_WORKER_THREADS=8
export SUPERVISOR_STRUCTURED_QUERY_BASE_URL=http://supervisor-api:8000
export SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET=query-secret
export SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS=1
```

`PROMPT_RUNTIME_MODEL` 是 shared default。未显式提供 `SUPERVISOR_PROMPT_MODEL` /
`SPECIALIST_PROMPT_MODEL` 时，两条角色链都会继承 `PROMPT_RUNTIME_MODEL`。

只有 provider、api key、supervisor/specialist model 与
`PROMPT_STRICT_STRUCTURED_OUTPUTS=true` 同时满足时，`prompt_runtime.admitted` 才会为
`true`。

Python bridge 不再拥有本地 supervisor audit JSONL writer。execution audit 由 Go
`apps/supervisor-api` 的 allowlisted audit writer 负责回流到 `app-api` internal
ingest；Python bridge 只保留可注入 `audit_sink` seam 供测试或特殊 harness 使用。

`SUPERVISOR_STRUCTURED_QUERY_BASE_URL` / `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET`
只用于 Python worker 调用 Go `supervisor-api` 的 internal
`/internal/query/campus-services/*` seam。未配置时，`campus-services-agent`
继续保持 internal query service unavailable，不会打开产品 serving gate。
