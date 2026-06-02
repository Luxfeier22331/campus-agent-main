---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-06-01
---
# Supervisor API Staging Operations

## 文档边界

这份 runbook 只回答当前 canonical staging execution upstream 的长期运维真相：

- 当前 repo-owned staging execution runtime 是 `otel-collector + supervisor-api + supervisor-agent-worker`
  三容器
- `exec-staging.mucwiki-edge.link` 通过 Cloudflare remote-managed named tunnel 指向
  `nc-arm-6c` 上的本地 `supervisor-api` runtime

它不覆盖 browser smoke 证据采集；那部分统一看
`supervisor-api-staging-smoke-runbook.md`。
它也不作为通用 Linux server 部署文档；server handoff 见
`supervisor-api-server-handoff.md`。

## 当前真相

- `apps/supervisor-api` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- 当前 repo-owned staging execution runtime：
  - `infra/local/docker-compose.supervisor-runtime.yml`
  - `otel-collector`
    - repo-owned runtime telemetry fan-out
    - local OTLP ingress `4317/4318`
    - health check `13133`
  - `supervisor-api`
    - `trusted-worker`
    - `127.0.0.1:27051`
    - `/healthz` `/readyz` `/metrics` `/api/v1/answer`
    - bounded in-process admission queue / backpressure / graceful drain
  - `supervisor-agent-worker`
    - private `/internal/bridge/*`
- named tunnel：
  - tunnel name: `supervisor-api-staging`
  - tunnel id: `7d0db8a7-53bd-417d-8028-548c35c8e30e`
  - public hostname: `<https://exec-staging.mucwiki-edge.link`>
  - Cloudflare remote config 必须把该 hostname 指到 connector 本机
    `http://127.0.0.1:27051`
  - DNS record:
    `exec-staging.mucwiki-edge.link CNAME 7d0db8a7-53bd-417d-8028-548c35c8e30e.cfargotunnel.com`,
    proxied
- shared staging `app-api`：
  - `<https://api-staging.mucwiki-edge.link`>
- canonical staging host：`nc-arm-6c`, repo path `/srv/apps/campus-agent`
- 常驻机制：
  - Docker Compose runtime: `infra/local/staging/start-supervisor-api-staging.sh`
  - Cloudflare connector: systemd service
    `cloudflared-supervisor-api-staging.service`
  - strict health check: `infra/local/staging/status-supervisor-api-staging.sh --check`
  - lifecycle lock: `.tmp/supervisor-api-staging/lifecycle.lock`

以上是当前 `nc-arm-6c` staging host 特定形态，不代表 production substrate。

## 安装与重装

### 1. 同步 repo

在本机 release branch 上把仓库同步到 `nc-arm-6c`：

```bash
rsync -a --delete --exclude .git --exclude .worktrees --exclude node_modules \
  --exclude .venv --exclude .tmp --exclude .env \
  --exclude .env.staging.local --exclude .env.qdrant.local \
  ./ nc-arm-6c:/srv/apps/campus-agent/
```

### 2. 写入 staging operator secret

在 `nc-arm-6c:/srv/apps/campus-agent` 准备 ignored secret 文件：

- repo-root `.env.staging.local`：Worker deploy/smoke 和 supervisor lifecycle 共享的
  staging operator secret
- `apps/app-api/.dev.vars`：`app-api` runtime secret 与 supervisor shared secret
- 各 web app `.dev.vars`：只供 staging build/deploy secret presence gate 使用

`infra/local/staging/start-supervisor-api-staging.sh` 会按顺序读取 `.env`、
`.env.staging.local`、`apps/app-api/.dev.vars`，再把允许进入 runtime 的 key 注入
Compose。

`.env.staging.local` 必须包含：

- `STAGING_SUPERVISOR_API_BASE_URL=https://exec-staging.mucwiki-edge.link`
- `STAGING_INGESTION_SHARED_POSTGRES_URL=<staging shared Postgres URL>`；
  如果使用 Supabase，必须是 session pooler `:5432` DSN，并包含 `sslmode=require`
- `STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=<registry Postgres URL>`；
  如果使用 Supabase，必须是 session pooler `:5432` DSN，并包含 `sslmode=require`
- `STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=<raw registry Postgres URL>`；
  如果使用 Supabase，必须是 session pooler `:5432` DSN，并包含 `sslmode=require`
- `STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL=<staging operator Postgres URL>`；用于
  one-time ingestion/registry 运维 CLI，不允许从 root `.env` 的本地 operator DSN 补齐
- document registry operator URL:
  `STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL`
- raw asset registry operator URL:
  `STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL`
- `STAGING_INGESTION_OBJECT_STORE_ENDPOINT=<staging S3-compatible object store endpoint>`
- `STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging`
- `STAGING_INGESTION_OBJECT_STORE_REGION=auto`（Cloudflare R2 S3 endpoint）
- `STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=<derived bucket access key>`
- `STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=<derived bucket secret key>`
- `STAGING_INGESTION_QDRANT_URL=<staging self-hosted Qdrant REST URL>`；当前默认是
  `nc-arm-6c` 上的 self-hosted single-node Qdrant，本机/同主机 runtime 通常填
  `http://127.0.0.1:6333`。该 URL 必须让 `/readyz`、`/livez`、`/collections`
  返回 `200`，不能填 cluster 管理页、错误 hostname 或公网未授权入口
- `STAGING_INGESTION_QDRANT_API_KEY=<staging Qdrant API key>`
- `STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=<staging Qdrant read-only API key>`；
  同机 self-hosted Qdrant 由 lifecycle 脚本启动时必填
- `STAGING_INGESTION_EMBEDDING_*` 与 `STAGING_INGESTION_SPARSE_*`，必须与当前
  query-serving index release metadata 匹配。当前 staging baseline 固定为：
  - `STAGING_INGESTION_EMBEDDING_PROVIDER=gitee`
  - `STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1`
  - `STAGING_INGESTION_EMBEDDING_API_KEY=<secret>`
  - `STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B`
  - `STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560`
  - `STAGING_INGESTION_SPARSE_PROVIDER=qdrant`
  - `STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25`
  - `STAGING_INGESTION_SPARSE_TOKENIZER=multilingual`
  - `STAGING_INGESTION_SPARSE_LANGUAGE=none`
- `STAGING_ACCESS_TEAM_DOMAIN=https://ayafeed.cloudflareaccess.com`
- `STAGING_ACCESS_POLICY_AUD=<panel-staging Access aud>`
- `SUPERVISOR_API_METRICS_BEARER_TOKEN=<metrics bearer token>`
- `SUPERVISOR_API_STAGING_TUNNEL_TOKEN=<Cloudflare tunnel token>`
- `SUPERVISOR_AGENT_WORKER_SHARED_SECRET=<bridge secret>`
- `SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=<structured query secret>`

`STAGING_APP_API_OPERATOR_DATABASE_URL` 只用于 `app-api` staging schema/bootstrap/operator
脚本；即使它物理上和 runtime shared Postgres 相同，也必须单独写入
`STAGING_INGESTION_SHARED_POSTGRES_URL` /
`STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL` /
`STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL`。
supervisor lifecycle 不会从 root `.env`、`apps/app-api/.dev.vars` 或
`STAGING_APP_API_OPERATOR_DATABASE_URL` 猜测 retrieval runtime 数据面。缺任一
`STAGING_INGESTION_*` 必填项时，`start-supervisor-api-staging.sh` 会 fail closed。
generic `EMBEDDING_*` / `SPARSE_*` 不能替代 staging 的
`STAGING_INGESTION_EMBEDDING_*` / `STAGING_INGESTION_SPARSE_*`。

Cloudflare R2 staging object store 固定为：

- endpoint: `https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com`
- source bucket: `campus-rag-source-staging`
- derived bucket: `campus-rag-derived-staging`

`supervisor-api` 在线 notice body runtime 只需要 derived bucket 凭据，因此 staging
runtime 使用只限 `campus-rag-derived-staging` 的 R2 bucket-item token。按 Cloudflare R2
文档，R2 S3 凭据不是普通 bearer token：Access Key ID 是 API token id，Secret Access
Key 是 API token value 的 SHA-256。token value 只在创建时显示；创建后必须立即写入
部署 secret 或 `/srv/apps/campus-agent/.env.staging.local`，不得进入 repo。

如果 query-serving index 或 notice read-model 已引用 `campus-rag-derived` 的 object key
内容，不能只创建空的 `campus-rag-derived-staging` bucket 后宣布 staging 可用；必须先执行
受控对象迁移或重新发布 staging seed，使 DB/read-model 与 R2 bucket 内容一致。

`apps/app-api/.dev.vars` 必须包含：

- `SUPERVISOR_API_SHARED_SECRET`
- `APP_API_INTERNAL_SHARED_SECRET`
- app-api runtime secrets；retrieval data-plane、object-store 与 supervisor-agent-worker
  query env 不放在这里，统一由 repo-root `.env.staging.local` 的
  `STAGING_INGESTION_*` 投影进入 Compose runtime

### 3. 安装 cloudflared systemd service

在 `nc-arm-6c` 安装 `cloudflared` 到 `/usr/local/bin/cloudflared` 后执行：

```bash
cd /srv/apps/campus-agent
sudo SUPERVISOR_API_STAGING_TUNNEL_TOKEN=<Cloudflare tunnel token> \
  infra/local/staging/install-supervisor-api-staging-cloudflared-service.sh
```

确认：

- 非登录 SSH shell 必须能执行 `uv`，或在 `.env.staging.local` 显式设置
  `SUPERVISOR_API_STAGING_UV_BIN=/home/deploy/.local/bin/uv`；staging lifecycle
  不会跳过 `doctor_env`。

```bash
systemctl --no-pager --full status cloudflared-supervisor-api-staging.service
```

### 4. 启动 supervisor runtime

```bash
cd /srv/apps/campus-agent
infra/local/staging/start-supervisor-api-staging.sh
infra/local/staging/status-supervisor-api-staging.sh --check
```

## 日常健康检查

人类可读状态：

```bash
infra/local/staging/status-supervisor-api-staging.sh
```

严格健康检查：

```bash
infra/local/staging/status-supervisor-api-staging.sh --check
```

`--check` 通过标准：

- `otel-collector`、`supervisor-api` 与
  `supervisor-agent-worker` 都在当前 compose project 中运行
- `cloudflared-supervisor-api-staging.service` 处于 active/running，且 Cloudflare
  tunnel status 为 healthy
- 本地 `<http://127.0.0.1:27051/healthz`> 返回 `200`
- 本地 `<http://127.0.0.1:27051/readyz`> 带 `x-worker-origin-auth` 返回 `200`
- 本地 `<http://127.0.0.1:27051/metrics`> 带 bearer token 返回 `200`
- `<https://api-staging.mucwiki-edge.link/readyz`> 返回 `200`
- `api-staging` 的 `auth`、`database`、`supervisorApi` 都是 `ready`

补充约束：

- `supervisor-api` 默认 admission 参数为 `SUPERVISOR_API_MAX_CONCURRENT_ANSWERS=8`、
  `SUPERVISOR_API_QUEUE_CAPACITY=24`、`SUPERVISOR_API_QUEUE_TIMEOUT_MS=3000`、
  `SUPERVISOR_API_REQUEST_TIMEOUT_MS=45000` 与
  `SUPERVISOR_AGENT_WORKER_TIMEOUT_MS=35000`
- 默认 bridge protection 参数为 `SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD=5`、
  `SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS=10000`、
  `SUPERVISOR_API_BRIDGE_RETRY_MAX_ATTEMPTS=2` 与
  `SUPERVISOR_API_BRIDGE_RETRY_BASE_MS=50`
- 默认 lane budget 为 `rag=6/12/3000ms`、`navigation=2/4/1500ms`、
  `campus_services=2/4/1500ms`、`notice=2/4/1500ms`、`default=1/2/1500ms`；
  三元组含义为 `max_concurrent / queue_capacity / queue_timeout`
- staging 默认启用 `SUPERVISOR_API_OTEL_ENABLED=true`、
  `SUPERVISOR_API_OTEL_METRICS_ENABLED=true` 与
  `SUPERVISOR_AGENT_WORKER_OTEL_ENABLED=true`
- `supervisor-api` traces / metrics 都应发往本地 `otel-collector`
- `supervisor-agent-worker` runtime events 可以同时保留 JSONL debug sink，并直接发往
  本地 `otel-collector` 的 OTLP HTTP traces / metrics / logs endpoints
- OTel attribute allowlist、forbidden fields 与 sink ownership 以
  `docs/reference/runtime-otel-telemetry-taxonomy.md` 为准；staging 不应把 raw prompt、
  raw query、raw answer、token、cookie、auth material 或正文片段发往 Sentry/Axiom
- Collector / Sentry / Axiom fan-out 操作以
  `docs/runbooks/runtime-otel-collector-pipeline.md` 为准；runtime 只把 sanitized OTLP
  发给 Collector，vendor endpoint/header/dataset 由部署 secret 注入
- `supervisor-api` 会从入口请求提取 `traceparent` / `baggage`；为兼容当前
  `app-api` 链路，也会把有效的 `sentry-trace` 转成标准 `traceparent`。向
  `supervisor-agent-worker` 只传播 `traceparent`、`baggage`、`x-request-id`
  与 `x-trace-id`
- staging profile 必须设置 `SUPERVISOR_API_METRICS_BEARER_TOKEN`；
  `status-supervisor-api-staging.sh` 会用该 token 拉取本地 `/metrics`，且不应把
  raw token 写入日志
- staging profile 下，supervisor-api full `/readyz` 是内部 runtime probe；
  local lifecycle script 使用 `API_WORKER_SHARED_SECRET` 对本地 `/readyz` 加
  `x-worker-origin-auth`。public deploy / smoke closure 不直接要求
  `exec-staging.mucwiki-edge.link/readyz`，而是通过 `api-staging /readyz`
  证明 app-api 已用内部 shared secret 完成 supervisor readiness probe
- `/readyz` 不因瞬时 `active_answers == max_concurrent_answers` 直接 degraded；只有
  admission queue 已不可接收、runtime draining 或 bridge 不健康时才视为 execution
  runtime 不 ready
- `supervisor-agent-worker` 必须同时拿到 query runtime env，包括
  `SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET`、`QDRANT_URL`、`QDRANT_API_KEY`、
  `QDRANT_TIMEOUT_SECONDS`、`DOCUMENT_REGISTRY_DATABASE_URL`、
  `RAW_ASSET_REGISTRY_DATABASE_URL`、`CAMPUS_SHARED_POSTGRES_URL`、`EMBEDDING_*`
  与 `SPARSE_*`
- `infra/local/staging/start-supervisor-api-staging.sh` 会从 `.env`、
  `.env.staging.local` 与 `apps/app-api/.dev.vars` 导入基础 secret，但 query/runtime
  数据面只接受 repo-root `.env.staging.local` 中的 `STAGING_INGESTION_*`，再投影成
  Compose 里的 `CAMPUS_SHARED_POSTGRES_URL`、`DOCUMENT_REGISTRY_DATABASE_URL`、
  `RAW_ASSET_REGISTRY_DATABASE_URL`、`CAMPUS_SHARED_POSTGRES_OPERATOR_URL`、
  `DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL`、`RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL`、
  `OBJECT_STORE_*`、`QDRANT_*`、`EMBEDDING_*` 与 `SPARSE_*`
- `STAGING_INGESTION_SHARED_POSTGRES_URL`、`STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL`、
  `STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL` 与
  `STAGING_INGESTION_OBJECT_STORE_ENDPOINT` 允许在 `nc-arm-6c` 同机自托管部署中填写
  `127.0.0.1` / `localhost`。这些值只表示 host-side 运维 / preflight URL；lifecycle
  脚本会在 Docker compose 环境中分别投影成 `postgres:5432` 与 `minio:9000`。
  repo-owned local Postgres 是 single-node dependency，所有本地 Postgres DSN 必须使用同一
  database/user/password/port；repo-owned local MinIO 是 single-node dependency，
  shared 与 derived credential 同时配置时必须是同一组 credential。
- `STAGING_INGESTION_QDRANT_URL` 允许在 `nc-arm-6c` 同机自托管部署中填写
  `http://127.0.0.1:6333`。该值只表示 host-side 运维 / preflight URL。lifecycle
  脚本会在 Docker compose 环境中投影成
  `QDRANT_DOCKER_URL=http://qdrant:6333`，并要求 supervisor runtime 与 Qdrant 同时加入
  repo-owned `campus-agent-data-plane` Docker network。容器内 retrieval runtime 必须通过
  Docker service DNS 访问 Qdrant，不得依赖 Docker gateway 或旧开发机 `172.*` 地址。
- 同机 Docker data-plane 内的 Qdrant 通信使用 HTTP + API key；`6333` 只绑定
  `127.0.0.1`，不公网裸露。TLS 不作为同机容器网络 blocker；一旦 Qdrant 跨主机、
  公网、Tunnel 或 VPC 间通信，TLS 与网络层隔离升级为硬要求。
- query runtime 使用 `STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY` 投影出的 read-only
  key；ingestion、snapshot backup 和 restore 运维使用 admin key。
- sparse retrieval / indexing 使用 self-hosted Qdrant server-side BM25 inference：
  Python runtime 发送 `qdrant/bm25` `Document`，不部署 Qdrant Cloud，不部署独立 BM25
  服务，也不在生产路径使用本地 FastEmbed。
- staging runtime 启动前会确保 `campus-agent-data-plane` Docker network 存在；启动后会从
  `supervisor-agent-worker` 容器内访问 Qdrant `/readyz` 与 `/collections`，该容器视角检查
  失败时直接 fail closed。
- staging runtime 启动前会执行 ingestion registry collection rename audit：
  `campus_ingestion_worker.collection_rename_registry_backfill audit`。如果
  `regulations/student_handbook` 或 `regulations/institutional_regulations` 仍残留在
  `document_registry` / `raw_asset_registry` 的 `collection` 列或 `record.collection`，
  `start-supervisor-api-staging.sh` 会 fail closed。先执行 apply：

```bash
cd /srv/apps/campus-agent
source infra/local/staging/supervisor-api-staging-common.sh
supervisor_api_staging_load_env >/dev/null
uv run --all-packages python -m \
  campus_ingestion_worker.collection_rename_registry_backfill audit
uv run --all-packages python -m \
  campus_ingestion_worker.collection_rename_registry_backfill apply
uv run --all-packages python -m \
  campus_ingestion_worker.collection_rename_registry_backfill audit
```

最后一轮 audit 必须显示所有 target 的 `legacy_row_count=0`，再启动 supervisor
runtime。不要在 retrieval/read path 增加 `student_handbook` alias。

- staging runtime 启动前还会执行 RAG runtime readiness probe：
  `campus_ingestion_worker.probe_regulation_rag_release_runtime`，并显式检查
  `regulations/student_rules`、`regulations/institutional_rules` 与
  `curriculum/curriculum_plan`。
  该 gate 会检查 Qdrant REST endpoint、serving alias、latest published release、alias
  freshness 与 release metadata guard；任一 core query-serving surface 不 ready 时
  `start-supervisor-api-staging.sh` 会 fail closed。典型 blocker：
  - `qdrant_endpoint_not_ready`：`QDRANT_URL` 不是可用 REST endpoint，先从 Qdrant
    Cloud cluster detail 复制正确 URL，再重跑 probe
  - `alias_not_published`：对应 serving alias 未发布，先执行 release/publish 流程
  - `stale_alias`：alias 指向旧 physical collection，先切换到 latest published release
  - `release_metadata_guard_failed`：query runtime 的 embedding/sparse/profile 设置与
    index release metadata 不一致，先修 env 或重新发布 index release
- 当 compose project 尚未运行、启动脚本需要 `docker compose up -d --build` 时，
  `start-supervisor-api-staging.sh` 会先执行
  `infra/local/staging/preflight-supervisor-api-staging.sh`
- preflight 会通过 `docker version --format '{{.Server.Version}}'` 检查 Docker daemon，
  并检查 Docker Compose v2、compose 文件存在性，以及当前 staging Dockerfile 依赖的 base image
  registry 可达性：
  - `golang:1.26.2-bookworm`
  - `debian:bookworm-slim`
  - `python:3.12-slim-bookworm`
  - `ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim`
- registry preflight 默认使用 `docker buildx imagetools inspect`；设置
  `SUPERVISOR_API_STAGING_PREFLIGHT_PULL=1` 时改用 `docker pull`
- Docker daemon / Compose 基础检查默认 `10s` 超时，可用
  `SUPERVISOR_API_STAGING_PREFLIGHT_DOCKER_TIMEOUT_SECONDS` 调整；registry 检查默认
  `30s` 超时，可用 `SUPERVISOR_API_STAGING_PREFLIGHT_REGISTRY_TIMEOUT_SECONDS` 调整
- 如果 staging host 已经预拉取 base image 且处于受控离线/代理故障窗口，可设置
  `SUPERVISOR_API_STAGING_PREFLIGHT_SKIP_REGISTRY=1` 跳过 registry 检查；这只应作为本机
  环境绕过，不表示 registry 依赖已恢复

systemd 层状态：

```bash
systemctl --no-pager --full status cloudflared-supervisor-api-staging.service
```

## 冷启动恢复

当前 canonical 冷启动恢复流程：

```bash
cd /srv/apps/campus-agent
infra/local/staging/stop-supervisor-api-staging.sh
sudo systemctl restart cloudflared-supervisor-api-staging.service
infra/local/staging/start-supervisor-api-staging.sh
until infra/local/staging/status-supervisor-api-staging.sh --check; do \
  sleep 2; done
```

说明：

- `cloudflared` connector 和 Docker Compose runtime 是两个独立常驻单元
- `status --check` 要同时证明本地 runtime、Cloudflare tunnel 和 shared `app-api`
  readiness
- 如果旧的 dev-backed runtime 还在运行，必须先停掉 legacy runtime，再启动 canonical
  runtime

## 日志与轮转

日志目录：

- `.tmp/supervisor-api-staging/logs/otel-collector.log`
- `.tmp/supervisor-api-staging/logs/supervisor-api.log`
- `.tmp/supervisor-api-staging/logs/supervisor-agent-worker.log`
- `.tmp/supervisor-api-staging/logs/cloudflared.log`

轮转规则：

- 每次执行 `start-supervisor-api-staging.sh` 时都会检查日志大小
- 单文件超过 `20 MiB` 时做 copy-truncate 轮转
- 最多保留 `5` 份历史：`.1` 到 `.5`

## 故障分流

`status --check` 报 `supervisor-api compose project is not fully running`

- 先看：
  - `.tmp/supervisor-api-staging/logs/supervisor-api.log`
  - `.tmp/supervisor-api-staging/logs/supervisor-agent-worker.log`
- 如果 `start-supervisor-api-staging.sh` 在 build 前失败，先直接运行：

```bash
infra/local/staging/preflight-supervisor-api-staging.sh
```

- preflight 在 `docker buildx imagetools inspect ...` 或 `docker pull ...`
  阶段失败，通常是 Docker Desktop registry/proxy 配置或到 Docker Hub/GHCR
  的网络不可达；先修 Docker registry 访问，或确认 base images 已经缓存后临时设置
  `SUPERVISOR_API_STAGING_PREFLIGHT_SKIP_REGISTRY=1`
- 再直接执行：

```bash
cd <repo-root>
COMPOSE_PROJECT_NAME=campus-supervisor-api-staging \
SUPERVISOR_API_HOST_PORT=27051 \
docker compose -f infra/local/docker-compose.supervisor-runtime.yml ps
```

`status --check` 报 `local readyz returned HTTP ...`

- 说明 `supervisor-api` 或 `supervisor-agent-worker` 还没达到真实 runtime ready
- 先跑：

```bash
uv run --all-packages python -m scripts.doctor_env supervisor-api --json
```

- 再看 `supervisor-agent-worker.log` 中缺的是 prompt runtime、HTTP pool 还是 worker runtime

真实 chat smoke 返回 `supervisor_unavailable`，且 `supervisor-agent-worker.log` 中出现
`QDRANT_URL is required`

- 说明 transport ready，但 query runtime env 没有进入 Docker runtime
- 先确认容器里变量存在：

```bash
docker exec campus-supervisor-api-staging-supervisor-agent-worker-1 \
  sh -lc 'for k in QDRANT_URL DOCUMENT_REGISTRY_DATABASE_URL \
  SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET EMBEDDING_MODEL; do \
  eval v=\${$k:-}; [ -n "$v" ] && echo "$k=set" || echo "$k=unset"; done'
```

execution audit 不出现在 panel 审计时间线

- 先看 `supervisor-api` 的 `/readyz` 中 `execution_audit_runtime`
- 再看 `/metrics`：

```bash
curl -sS http://127.0.0.1:27051/metrics | grep execution_audit
```

- staging lifecycle 会优先读取显式 `SUPERVISOR_API_EXECUTION_AUDIT_*`
  变量；未显式配置时，会从 `SUPERVISOR_API_STAGING_APP_API_BASE_URL` 与
  `APP_API_INTERNAL_SHARED_SECRET` 派生 internal ingest URL 和 shared secret
- 如果 emitted 增加但 panel 未出现，检查 `app-api` scheduled projector drain；
  internal ingest 成功时也会触发 request-scoped drain，cron 只承担周期性一致性检查

- 如果变量缺失，重新执行：

```bash
infra/local/staging/stop-supervisor-api-staging.sh
infra/local/staging/start-supervisor-api-staging.sh
```

`status --check` 报 `public readyz returned HTTP ...`

- 优先判断 named tunnel connector 是否掉线
- 用 `systemctl status cloudflared-supervisor-api-staging.service` 与 Cloudflare tunnel
  status 确认 connector 是否注册成功
- 如果 systemd 运行但 tunnel 仍 down，确认
  `/etc/campus-agent/supervisor-api-staging-cloudflared.env` 中的 `TUNNEL_TOKEN`
  是否来自当前 `supervisor-api-staging` tunnel

`status --check` 报 `app-api readyz ...`

- 说明本地 supervisor-api runtime 可能健康，但 shared staging `app-api` 自身或它到 supervisor 的依赖不健康
- 直接检查：

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
```

- 如果只有 `supervisorApi` 失败，先回到这份 runbook 的冷启动恢复流程

## Recovery Boundary

当前 active recovery path 是重启 `supervisor-api + supervisor-agent-worker` 双容器 runtime。
仓库不再维护 dev-backed Python public ingress fallback。

## Staging RAG Release Manifest Recovery

Use this path only when all of the following are true:

1. self-hosted Qdrant is healthy;
1. the serving alias points at the intended physical collection;
1. a native snapshot bundle exists under
   `/srv/backups/campus-agent/qdrant-snapshots`;
1. runtime readiness is blocked because the derived object store lacks the
   matching `index-release.json`.

Run the dry-run reconstruction first:

```bash
uv run --all-packages campus-ingestion-reconstruct-rag-release-manifests \
  --backup-root /srv/backups/campus-agent/qdrant-snapshots \
  --report-path var/staging-evidence/rag-release-manifest-reconstruction.json
```

If the report shows the expected four current surfaces and exact manifest keys,
write the manifests:

```bash
uv run --all-packages campus-ingestion-reconstruct-rag-release-manifests \
  --backup-root /srv/backups/campus-agent/qdrant-snapshots \
  --report-path var/staging-evidence/rag-release-reconstruction-write.json \
  --write
```

Then verify readiness:

```bash
uv run --all-packages campus-ingestion-probe-regulation-rag-release-runtime
infra/local/staging/status-supervisor-api-staging.sh --check
```

Do not use this command to bypass a failed ingestion release. If Qdrant payload
metadata or the native snapshot sidecar is inconsistent, rebuild or restore the
affected release instead.
