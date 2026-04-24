# campus-supervisor-api

`apps/supervisor-api` 是 Docker-first supervisor execution service 里的 Python
orchestration worker。

当前 public/internal HTTP execution ingress 已 hardcut 到 `apps/go-shell`。本 package
不再暴露 public `/api/v1/answer`，也不再负责 bearer / trusted-worker caller auth、
request body limit、transport admission、queue、metrics 或 published `transport_runtime`。

## Responsibilities

Python worker 只负责：

- 接收 Go shell 已投影好的 private `SupervisorRequest`
- 调用 `packages/supervisor-core`
- 绑定 prompt runtime / provider-backed executors
- 在配置 structured query internal seam 时，为 `campus-services-agent`
  注入 Go shell query service client
- 写入 supervisor audit JSONL
- 暴露 private bridge health / readiness
- 接收 Go shell 的 cooperative cancel signal，并在 Python bridge registry
  中标记 active request id

Python worker 不负责：

- browser-facing chat / panel API
- product-layer auth / session / conversation
- public execution transport
- Go shell admission / backpressure / metrics
- retrieval / ingestion data-plane ownership

## Private Bridge Surface

唯一支持的 HTTP routes 是：

- `POST /internal/bridge/supervisor/answer`
- `POST /internal/bridge/execution/cancel`
- `GET /internal/bridge/healthz`
- `GET /internal/bridge/readyz`

所有 bridge routes 都要求：

- `x-supervisor-bridge-auth: <secret>`
- `SUPERVISOR_PY_BRIDGE_SHARED_SECRET=<secret>`

`/internal/bridge/readyz` 只报告 Python worker 自身状态：

- `prompt_runtime`
- `prompt_http_pool`
- `audit_runtime`
- `execution_cancel_runtime`

Go shell `/readyz` 会聚合 Python worker readiness，并发布唯一的 execution
`transport_runtime`。

`/internal/bridge/execution/cancel` 只记录 cooperative cancellation state。当前
Python semantic orchestration 仍是同步调用，provider / prompt executor mid-flight stop
需要后续在 semantic runtime 内继续接入。

## Runtime Entry

Repo-local worker entry：

```bash
uv run --all-packages campus-supervisor-orchestrator-dev
```

默认监听：

```bash
SUPERVISOR_PY_BRIDGE_HOST=127.0.0.1
SUPERVISOR_PY_BRIDGE_PORT=18081
SUPERVISOR_PY_BRIDGE_WORKER_THREADS=8
```

Docker image：

```bash
docker build -f apps/supervisor-api/Dockerfile \
  -t campus-supervisor-orchestrator:local .
```

完整本地 runtime 使用双容器：

```bash
docker compose -f infra/local/docker-compose.supervisor-runtime.yml up --build
```

## Prompt And Audit Env

```bash
export SUPERVISOR_PY_BRIDGE_SHARED_SECRET=bridge-secret
export PROMPT_RUNTIME_PROVIDER=openai-responses
export PROMPT_RUNTIME_TRANSPORT=responses
export PROMPT_RUNTIME_MODEL=gpt-5.4
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
export AUDIT_QUEUE_CAPACITY=1024
export SUPERVISOR_PY_BRIDGE_WORKER_THREADS=8
export SUPERVISOR_STRUCTURED_QUERY_BASE_URL=http://go-shell:27010
export SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET=query-secret
export SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS=1
```

`PROMPT_RUNTIME_MODEL` 是 shared default。未显式提供 `SUPERVISOR_PROMPT_MODEL` /
`SPECIALIST_PROMPT_MODEL` 时，两条角色链都会继承 `PROMPT_RUNTIME_MODEL`。

只有 provider、api key、supervisor/specialist model 与
`PROMPT_STRICT_STRUCTURED_OUTPUTS=true` 同时满足时，`prompt_runtime.admitted` 才会为
`true`。

Audit 写入在 request path 上只 enqueue；后台 writer 负责 JSONL append。audit 写入失败不会把成功回答改写成
`500`，但会通过 `readyz.audit_runtime.healthy=false` 暴露。

`SUPERVISOR_STRUCTURED_QUERY_BASE_URL` / `SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET`
只用于 Python worker 调用 Go shell 的 internal
`/internal/query/campus-services/*` seam。未配置时，`campus-services-agent`
继续保持 internal query service unavailable，不会打开产品 serving gate。
