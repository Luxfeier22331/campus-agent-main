---
doc_type: runbook
status: active
created: 2026-04-24
updated: 2026-06-06
---
# Execution Control Staging Operations

## 文档边界

这份 runbook 只回答当前 canonical staging execution upstream 的运维真相：

- 当前 repo-owned staging execution runtime 是
  `otel-collector + execution-control + supervisor-agent-worker` 三容器
- `execution-control` 不作为 public staging surface 存在；用户、浏览器、panel、docs
  与 chat 只进入 browser surface 或 `app-api`
- `execution-control` 是 app-api-only trusted machine upstream。当前 machine
  ingress 是 `https://execution-control-staging.mucwiki-edge.link`，由
  Cloudflare proxied DNS、Cloudflare Access service-token policy 与 VM origin
  reverse proxy 承接

它不覆盖 browser smoke 证据采集；那部分统一看
`execution-control-staging-smoke-runbook.md`。
它也不作为通用 Linux server 部署文档；server handoff 见
`execution-control-server-handoff.md`。

## 当前真相

- `apps/execution-control` 的前向 deploy substrate 已冻结为 Docker-first internal execution
  service
- `app-api` 是唯一 product/API gateway；`execution-control` 不进入用户可见 endpoint
  list，也不作为 QA public endpoint
- 当前 repo-owned staging execution runtime：
  - `infra/local/docker-compose.execution-control-runtime.yml`
  - `otel-collector`
    - repo-owned runtime telemetry fan-out
    - local OTLP ingress `4317/4318`
    - health check `13133`
  - `execution-control`
    - `trusted-worker`
    - `127.0.0.1:27051`
    - `/healthz` `/readyz` `/metrics`
    - Temporal-backed execution run command/query seam：
      `/internal/execution/runs`,
      `/internal/execution/runs/:runId`,
      `/internal/execution/runs/:runId/events`,
      `/internal/execution/runs/:runId/steps`,
      `/internal/execution/runs/:runId/cancel`
    - PG-backed sanitized projection store：run store、events、step projection
      artifacts for app-api / panel / eval reads
    - Temporal workflow/activity workers for execution scheduling and retry
  - `supervisor-agent-worker`
    - private `/internal/bridge/*`
  - `temporal`
    - self-hosted Temporal frontend/history/matching/worker service
    - dedicated Temporal Postgres persistence / visibility store
  - `temporal-ui`
    - local-only operator UI
- machine ingress：
  - hostname: `execution-control-staging.mucwiki-edge.link`
  - Cloudflare DNS: proxied A/AAAA/CNAME 指向 staging VM
  - Cloudflare Access application: only service-token policy
  - VM reverse proxy: `443` -> `127.0.0.1:27051`
  - app-api 调用时同时带 Cloudflare Access service token 与
    `x-worker-origin-auth` shared secret；两者缺任一都必须 fail closed
- shared staging `app-api`：
  - `<https://api-staging.mucwiki-edge.link`>
- canonical staging host：`nc-arm-6c`, repo path `/srv/apps/campus-agent`
- 常驻机制：
  - Docker Compose runtime: `infra/local/staging/start-execution-control-staging.sh`
  - strict health check:
    `infra/local/staging/status-execution-control-staging.sh --check`
  - lifecycle lock: `.tmp/execution-control-staging/lifecycle.lock`

以上是当前 `nc-arm-6c` staging host 特定形态，不代表 production substrate。

当前 staging execution runtime 口径：

- staging 必须证明 Temporal-backed execution path、run projection store、
  workflow worker、RAG activity worker、finalization activity worker 与 app-api
  execution runtime ready。
- staging 不再使用 PG lease worker loop / recovery loop 作为 online serving path；旧 lease
  表只允许作为 historical migration artifact 存在。
- `execution-control-control`、`supervisor-scheduler`、`supervisor-recovery`、
  `supervisor-worker-{lane}` 与 `worker-autoscaler` 是 ADR-0047 时代的历史 target role
  label；target execution substrate 已由 ADR-0048 收口为
  `execution-control` + Temporal workflow/activity worker pools。
- staging 的 Docker Compose、origin reverse proxy、Cloudflare DNS 与 Cloudflare Access
  只负责部署与连接；不拥有 workflow history、task queue、run projection、event 或
  terminal truth。
- Redis 不参与 canonical execution queue。若以后用于 wakeup / fanout / cache，丢失或重启不得影响
  execution workflow / run projection / step projection / event truth。

## Deploy Checkout 与 Secret 边界

`/srv/apps/campus-agent` 是 deploy checkout，不是开发 worktree。staging host 上不得保留
tracked source 修改、临时 patch、未归档实验代码或 repo-local runtime secret。发现 dirty
worktree 时，不能在原目录 `git reset` 后继续部署；必须先 quarantine，再重建干净 checkout。

当前 forensic archive 保存在本地：

- `var/remote-worktree-audit/20260607T053116Z-srv-campus-agent/`

远端 quarantine 流程：

```bash
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
cd /srv/apps
if [ -d campus-agent ]; then
  cd campus-agent
  infra/local/staging/stop-execution-control-staging.sh || true
  cd ..
  mv campus-agent "campus-agent.quarantine-${timestamp}"
fi
git clone <repo-url> campus-agent
cd campus-agent
git fetch origin develop
git checkout --detach <release-sha>
git status --short --branch
git rev-parse HEAD
```

Quarantine 目录至少保留 7 天或直到 staging closeout 完成。不要从 quarantine 整文件覆盖
新 checkout；如果发现单个片段有价值，只能在本地以新 commit 移植并重新验证。

deploy checkout 启动前必须设置：

```bash
export EXECUTION_CONTROL_STAGING_EXPECTED_SHA=<release-sha>
export EXECUTION_CONTROL_STAGING_EXPECTED_REF=origin/develop
```

`start/status/preflight` 会拒绝：

- 缺 `EXECUTION_CONTROL_STAGING_EXPECTED_SHA`
- `HEAD` 不等于 pinned SHA
- tracked worktree dirty
- repo checkout 中存在 `.env`、`.env.staging.local` 或 `apps/app-api/.dev.vars`
- untracked 文件不匹配 `EXECUTION_CONTROL_STAGING_ALLOWED_UNTRACKED_REGEX`
- 缺 ops-owned runtime env file

`stop-execution-control-staging.sh` 允许在 dirty/quarantine 场景运行，避免无法停掉污染目录里的旧
runtime。

runtime env 与 secret 不属于 repo checkout。staging 默认读取：

- env file: `/srv/docker/campus-agent/staging/env/runtime.env`
- secret dir: `/srv/docker/campus-agent/staging/secrets/*.secret`

权限约束：

```bash
sudo install -d -m 0750 -o root -g deploy /srv/docker/campus-agent/staging/env
sudo install -d -m 0750 -o root -g deploy /srv/docker/campus-agent/staging/secrets
sudo install -m 0640 -o root -g deploy runtime.env \
  /srv/docker/campus-agent/staging/env/runtime.env
```

高敏值优先迁到 Compose `secrets:` 并挂载到 `/run/secrets/*`。暂不支持 `_FILE` 的服务可以
继续由 `runtime.env` 注入，但不得把 `.env.staging.local`、`.env` 或
`apps/app-api/.dev.vars` 放回 deploy checkout 作为 runtime dependency。

## 安装与重装

### 1. 同步 repo

在本机完成 commit/push 后，staging host 只 clone/fetch `origin/develop` 并 checkout pinned
release SHA。不要用 rsync 把本机 worktree 同步到 `/srv/apps/campus-agent`。
canonical staging lifecycle 固定使用：

- compose project: `campus-execution-control-staging`
- host port: `27051`
- runtime dir: `.tmp/execution-control-staging`

不要在 canonical `runtime.env` 中覆写
`EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME`、
`EXECUTION_CONTROL_STAGING_RUNTIME_DIR` 或 `EXECUTION_CONTROL_STAGING_PORT`。普通
`start/status` 脚本会拒绝被指到 isolated proof runtime，避免
machine ingress 指向 `27051` 但生命周期脚本操作另一个 compose project。

如果需要本机 Temporal proof，使用
`infra/local/staging/proof-execution-control-temporal-runtime-staging.sh`，并在该命令的
执行环境中显式设置 isolated project/runtime/port；不要把这些 proof 变量写进 canonical
staging runtime env。

### 2. 写入 Docker/ops runtime env

在 `/srv/docker/campus-agent/staging/env/runtime.env` 写入 staging runtime env。该文件由
Docker/ops 管理，不放在 repo checkout。必要时可以通过
`EXECUTION_CONTROL_STAGING_ENV_FILE=/custom/path/runtime.env` 显式覆盖，但 canonical
staging 不应依赖 repo-root `.env.staging.local`。

`runtime.env` 必须包含：

- `STAGING_EXECUTION_CONTROL_BASE_URL`
  = `https://execution-control-staging.mucwiki-edge.link`
- `STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID`
  = `<Cloudflare Access service token client id>`
- `STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
  = `<Cloudflare Access service token client secret>`
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
- `EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_*` 不需要手写；staging env projection 会从
  `STAGING_INGESTION_OBJECT_STORE_*` 明确生成 execution-control notice body runtime
  env。
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
- `STAGING_ACCESS_TEAM_DOMAIN=https://<current-access-team-domain>.cloudflareaccess.com`
- `STAGING_ACCESS_POLICY_AUD=<panel-staging Access aud>`
- `EXECUTION_CONTROL_METRICS_BEARER_TOKEN=<metrics bearer token>`
- `SUPERVISOR_AGENT_WORKER_SHARED_SECRET=<bridge secret>`
- `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=<structured query secret>`
- `EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=<run projection Postgres URL>`；
  这是 execution projection store 的显式 URL，不从 `STAGING_INGESTION_SHARED_POSTGRES_URL`、
  `EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL`、root `.env`、
  `apps/app-api/.dev.vars` 或其他 repo-local secret 推断。同机 self-hosted Postgres 场景通常写
  `postgresql://<user>:<password>@127.0.0.1:5432/campus_agent`；lifecycle 会把容器侧
  URL 投影为 `postgres:5432`。
- Temporal 必须显式配置：
  - `TEMPORAL_POSTGRES_PASSWORD=<temporal postgres password>`
  - `EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233`
  - `EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging`
  - `EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow`
  - `EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=staging:workflow-worker:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY=staging:activity-rag:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY=staging:activity-finalization:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=<workflow id salt>`
  - `EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000`
  缺任一 Temporal 必填配置时，lifecycle 必须 fail closed。
- `EXECUTION_CONTROL_DURABLE_WORKER_LOOP_*` 与
  `EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_*` 已退役；staging env 出现这些键时必须
  fail closed。

`STAGING_APP_API_OPERATOR_DATABASE_URL` 只用于 `app-api` staging schema/bootstrap/operator
脚本；即使它物理上和 runtime shared Postgres 相同，也必须单独写入
`STAGING_INGESTION_SHARED_POSTGRES_URL` /
`STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL` /
`STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL`。
execution-control lifecycle 不会从 root `.env`、`apps/app-api/.dev.vars` 或
`STAGING_APP_API_OPERATOR_DATABASE_URL` 猜测 retrieval runtime 数据面。缺任一
`STAGING_INGESTION_*` 必填项时，`start-execution-control-staging.sh` 会 fail closed。
generic `EMBEDDING_*` / `SPARSE_*` 不能替代 staging 的
`STAGING_INGESTION_EMBEDDING_*` / `STAGING_INGESTION_SPARSE_*`。
generic `CAMPUS_SHARED_POSTGRES_URL` 也不能替代
`EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL`；run projection store 必须有自己的
显式配置入口。

Cloudflare R2 staging object store 固定为：

- endpoint: `https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com`
- source bucket: `campus-rag-source-staging`
- derived bucket: `campus-rag-derived-staging`

`execution-control` 在线 notice body runtime 消费
`EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT`、
`EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY`、
`EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY`、
`EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION` 与
`EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET`。这些 env 由 staging
projection 从 `STAGING_INGESTION_OBJECT_STORE_*` 显式生成；Go runtime 不读取 generic
`OBJECT_STORE_*` 或 ingestion bucket env。staging runtime 目前指向
`campus-rag-derived-staging` 中的 canonical notice body object。按 Cloudflare R2 文档，
R2 S3 凭据不是普通 bearer token：Access Key ID 是 API token id，Secret Access Key
是 API token value 的 SHA-256。token value 只在创建时显示；创建后必须立即写入部署
secret 或 `/srv/docker/campus-agent/staging/env/runtime.env`，不得进入 repo checkout。

如果 query-serving index 或 notice read-model 已引用 `campus-rag-derived` 的 object key
内容，不能只创建空的 `campus-rag-derived-staging` bucket 后宣布 staging 可用；必须先执行
受控对象迁移或重新发布 staging seed，使 DB/read-model 与 R2 bucket 内容一致。

app-api Worker secrets 必须通过 Wrangler/Cloudflare secret 管理，至少包含：

- `EXECUTION_CONTROL_SHARED_SECRET`
- `EXECUTION_CONTROL_ACCESS_CLIENT_ID`
- `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET`
- `APP_API_INTERNAL_SHARED_SECRET`
- app-api runtime secrets；retrieval data-plane、object-store 与 supervisor-agent-worker
  query env 不放在这里，统一由 ops-owned `runtime.env` 的
  `STAGING_INGESTION_*` 投影进入 Compose runtime

### 3. 配置 machine ingress reverse proxy

Cloudflare 侧必须配置：

- DNS:
  `execution-control-staging.mucwiki-edge.link` proxied 到 staging VM
- Access application:
  hostname `execution-control-staging.mucwiki-edge.link`
- Access policy:
  only service-token allow policy；不允许 anonymous、email domain 或 public bypass

VM 侧使用 Caddy 或 Nginx 监听 `443`，只反代到本机 `127.0.0.1:27051`。
origin proxy 不直接暴露容器端口；execution-control container 继续只绑定本机 /
Docker data-plane。

Caddy 示例：

```caddy
execution-control-staging.mucwiki-edge.link {
  reverse_proxy 127.0.0.1:27051
}
```

未带 Cloudflare Access service token 的请求必须被 Access 拒绝：

```bash
curl --noproxy '*' -sS -i \
  https://execution-control-staging.mucwiki-edge.link/readyz
```

带 service token 与 `x-worker-origin-auth` 的请求应到达本机 execution-control：

```bash
access_secret="$STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_SECRET"
curl --noproxy '*' -sS -i \
  -H "CF-Access-Client-Id: $STAGING_EXECUTION_CONTROL_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $access_secret" \
  -H "x-worker-origin-auth: $EXECUTION_CONTROL_SHARED_SECRET" \
  https://execution-control-staging.mucwiki-edge.link/readyz
```

通过标准：

- 非登录 SSH shell 必须能执行 `uv`，或在 ops-owned `runtime.env` 显式设置
  `EXECUTION_CONTROL_STAGING_UV_BIN=/home/deploy/.local/bin/uv`；staging lifecycle
  不会跳过 `doctor_env`。
- unauthenticated request 被 Cloudflare Access 拒绝
- authenticated request 返回 `200`
- payload 中 `run_projection_store` 与 `temporal_runtime` 都是 configured/healthy
- VM 上没有任何 execution-control 容器端口直接公网裸露

### 4. 启动 execution runtime

启动脚本会在 Docker Compose runtime 启动前完成 run projection schema install/check：

- `infra/local/staging/start-execution-control-staging.sh` 先完成 env projection、
  Docker data-plane readiness 与 self-hosted dependency readiness，再执行
  `execution_control_staging_ensure_run_projection_store_schema`
- schema 命令入口是
  `apps/execution-control/cmd/run-projection-schema`
- `install` 模式调用 run projection Postgres store `EnsureSchema` 后执行 `HealthCheck`
- `check` 模式只执行 `HealthCheck`
- 两个模式都通过 `EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL` 访问容器侧
  projection store，不从 generic Postgres env 推断
- evidence 固定写入
  `${EXECUTION_CONTROL_STAGING_RUNTIME_DIR:-.tmp/execution-control-staging}/evidence/`
  下的：
  - `run-projection-schema-install.json`
  - `run-projection-schema-check.json`

schema install/check 任一失败时启动直接失败；不要用 proof command 代替 schema
安装。

```bash
cd /srv/apps/campus-agent
infra/local/staging/start-execution-control-staging.sh
infra/local/staging/status-execution-control-staging.sh --check
```

## 日常健康检查

人类可读状态：

```bash
infra/local/staging/status-execution-control-staging.sh
```

严格健康检查：

```bash
infra/local/staging/status-execution-control-staging.sh --check
```

`--check` 通过标准：

- `otel-collector`、`execution-control`、`workflow-worker`、
  `activity-worker-rag`、`activity-worker-finalization` 与
  `supervisor-agent-worker` 都在当前 compose project 中运行
- 本地 `<http://127.0.0.1:27051/healthz`> 返回 `200`
- 本地 `<http://127.0.0.1:27051/readyz`> 带 `x-worker-origin-auth` 返回 `200`
  且 payload 明确报告：
  - `run_projection_store.configured=true`
  - `run_projection_store.healthy=true`
  - `temporal_runtime.configured=true`
  - `temporal_runtime.healthy=true`
  - `temporal_runtime.namespace=campus-agent-staging`
  - `temporal_runtime.task_queue=campus-agent.workflow`
- 本地 `<http://127.0.0.1:27051/metrics`> 带 bearer token 返回 `200`
- machine ingress 未带 Access service token 时被 Cloudflare Access 拒绝
- machine ingress 带 Access service token 与 `x-worker-origin-auth` 时返回
  authenticated `/readyz 200`
- `<https://api-staging.mucwiki-edge.link/readyz`> 返回 `200`
- `api-staging` 的 `auth`、`database`、`executionControl` 与 `executionRuntime`
  都是 `ready`

当前 strict check 证明的是 Temporal execution plane + projection store + split
worker process readiness；它不等于 worker autoscaler 已完成。上线证据需要另行
记录 autoscaler proof 与 step trajectory projection。Temporal 通用运维证据要求见
`temporal-self-host-operations.md`。

补充约束：

- `execution-control` 默认 admission 参数为 `EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS=8`、
  `EXECUTION_CONTROL_QUEUE_CAPACITY=24`、`EXECUTION_CONTROL_QUEUE_TIMEOUT_MS=3000`、
  `EXECUTION_CONTROL_REQUEST_TIMEOUT_MS=45000` 与
  `SUPERVISOR_AGENT_WORKER_TIMEOUT_MS=35000`
- 默认 bridge protection 参数为 `EXECUTION_CONTROL_BRIDGE_BREAKER_FAILURE_THRESHOLD=5`、
  `EXECUTION_CONTROL_BRIDGE_BREAKER_OPEN_MS=10000`、
  `EXECUTION_CONTROL_BRIDGE_RETRY_MAX_ATTEMPTS=2` 与
  `EXECUTION_CONTROL_BRIDGE_RETRY_BASE_MS=50`
- 默认 lane budget 为 `rag=6/12/3000ms`、`navigation=2/4/1500ms`、
  `campus_services=2/4/1500ms`、`notice=2/4/1500ms`、`default=1/2/1500ms`；
  三元组含义为 `max_concurrent / queue_capacity / queue_timeout`
- durable lane budget 的目标语义是 PG-backed `max_active_leases`、queued run / queued step
  budget 与 lease timeout。上述 process-local 三元组只保留为当前 staging process protection，
  不得作为 worker autoscaling 或 production queue truth。
- staging 默认启用 `EXECUTION_CONTROL_OTEL_ENABLED=true`、
  `EXECUTION_CONTROL_OTEL_METRICS_ENABLED=true` 与
  `SUPERVISOR_AGENT_WORKER_OTEL_ENABLED=true`
- `execution-control` traces / metrics 都应发往本地 `otel-collector`
- `supervisor-agent-worker` runtime events 可以同时保留 JSONL debug sink，并直接发往
  本地 `otel-collector` 的 OTLP HTTP traces / metrics / logs endpoints
- OTel attribute allowlist、forbidden fields 与 sink ownership 以
  `docs/reference/runtime-otel-telemetry-taxonomy.md` 为准；staging 不应把 raw prompt、
  raw query、raw answer、token、cookie、auth material 或正文片段发往 Sentry/Axiom
- Collector / Sentry / Axiom fan-out 操作以
  `docs/runbooks/runtime-otel-collector-pipeline.md` 为准；runtime 只把 sanitized OTLP
  发给 Collector，vendor endpoint/header/dataset 由部署 secret 注入
- `execution-control` 会从入口请求提取 `traceparent` / `baggage`；为兼容当前
  `app-api` 链路，也会把有效的 `sentry-trace` 转成标准 `traceparent`。向
  `supervisor-agent-worker` 只传播 `traceparent`、`baggage`、`x-request-id`
  与 `x-trace-id`
- staging profile 必须设置 `EXECUTION_CONTROL_METRICS_BEARER_TOKEN`；
  `status-execution-control-staging.sh` 会用该 token 拉取本地 `/metrics`，且不应把
  raw token 写入日志
- staging profile 下，execution-control full `/readyz` 是 trusted machine probe；
  local lifecycle script 使用 `API_WORKER_SHARED_SECRET` 对本地 `/readyz` 加
  `x-worker-origin-auth`。release QA 不把 execution-control host 列为 public surface；
  product smoke 通过 `api-staging /readyz` 证明 app-api 已用 Access service token 和内部
  shared secret 完成 execution-control readiness probe
- `/readyz` 不因瞬时 `active_answers == max_concurrent_answers` 直接 degraded；只有
  admission queue 已不可接收、runtime draining 或 bridge 不健康时才视为 execution
  runtime 不 ready
- `supervisor-agent-worker` 必须同时拿到 query runtime env，包括
  `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`、`QDRANT_URL`、`QDRANT_API_KEY`、
  `QDRANT_TIMEOUT_SECONDS`、`DOCUMENT_REGISTRY_DATABASE_URL`、
  `RAW_ASSET_REGISTRY_DATABASE_URL`、`CAMPUS_SHARED_POSTGRES_URL`、`EMBEDDING_*`
  与 `SPARSE_*`
- `infra/local/staging/start-execution-control-staging.sh` 只读取
  `EXECUTION_CONTROL_STAGING_ENV_FILE` 指向的 ops-owned runtime env；默认路径是
  `/srv/docker/campus-agent/staging/env/runtime.env`。query/runtime 数据面只接受该文件中的
  `STAGING_INGESTION_*`，再投影成
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
  `QDRANT_DOCKER_URL=http://qdrant:6333`，并要求 execution runtime 与 Qdrant 同时加入
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
  `start-execution-control-staging.sh` 会 fail closed。先执行 apply：

```bash
cd /srv/apps/campus-agent
source infra/local/staging/execution-control-staging-common.sh
execution_control_staging_load_env >/dev/null
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
  `start-execution-control-staging.sh` 会 fail closed。典型 blocker：
  - `qdrant_endpoint_not_ready`：`QDRANT_URL` 不是可用 REST endpoint，先从 Qdrant
    Cloud cluster detail 复制正确 URL，再重跑 probe
  - `alias_not_published`：对应 serving alias 未发布，先执行 release/publish 流程
  - `stale_alias`：alias 指向旧 physical collection，先切换到 latest published release
  - `release_metadata_guard_failed`：query runtime 的 embedding/sparse/profile 设置与
    index release metadata 不一致，先修 env 或重新发布 index release
- 当 compose project 尚未运行、启动脚本需要 `docker compose up -d --build` 时，
  `start-execution-control-staging.sh` 会先执行
  `infra/local/staging/preflight-execution-control-staging.sh`
- preflight 会通过 `docker version --format '{{.Server.Version}}'` 检查 Docker daemon，
  并检查 Docker Compose v2、compose 文件存在性，以及当前 staging Dockerfile 依赖的 base image
  registry 可达性：
  - `golang:1.26.2-bookworm`
  - `debian:bookworm-slim`
  - `python:3.12-slim-bookworm`
  - `ghcr.io/astral-sh/uv:0.8.22-python3.12-bookworm-slim`
- registry preflight 默认使用 `docker buildx imagetools inspect`；设置
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_PULL=1` 时改用 `docker pull`
- Docker daemon / Compose 基础检查默认 `10s` 超时，可用
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_DOCKER_TIMEOUT_SECONDS` 调整；registry 检查默认
  `30s` 超时，可用 `EXECUTION_CONTROL_STAGING_PREFLIGHT_REGISTRY_TIMEOUT_SECONDS` 调整
- 如果 staging host 已经预拉取 base image 且处于受控离线/代理故障窗口，可设置
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_SKIP_REGISTRY=1` 跳过 registry 检查；这只应作为本机
  环境绕过，不表示 registry 依赖已恢复

## 冷启动恢复

当前 canonical 冷启动恢复流程：

```bash
cd /srv/apps/campus-agent
infra/local/staging/stop-execution-control-staging.sh
infra/local/staging/start-execution-control-staging.sh
until infra/local/staging/status-execution-control-staging.sh --check; do \
  sleep 2; done
```

说明：

- origin reverse proxy 和 Docker Compose runtime 是两个独立常驻单元
- `status --check` 要同时证明本地 runtime、machine ingress contract 和 shared `app-api`
  readiness
- 如果旧的 dev-backed runtime 还在运行，必须先停掉 legacy runtime，再启动 canonical
  runtime

## 日志与轮转

日志目录：

- `.tmp/execution-control-staging/logs/otel-collector.log`
- `.tmp/execution-control-staging/logs/otel-collector.recent.log`
- `.tmp/execution-control-staging/logs/execution-control.log`
- `.tmp/execution-control-staging/logs/supervisor-agent-worker.log`

轮转规则：

- 每次执行 `start-execution-control-staging.sh` 时都会检查日志大小
- 单文件超过 `20 MiB` 时做 copy-truncate 轮转
- 最多保留 `5` 份历史：`.1` 到 `.5`
- `otel-collector.log` 保留全量容器日志用于历史排障；`status --check` 的
  exporter failure gate 只读取 `otel-collector.recent.log`，即本次检查窗口内的
  collector 日志。历史上已经修复的 exporter 401/403 不应永久阻塞当前 readiness。

## 故障分流

`status --check` 报 `execution-control compose project is not fully running`

- 先看：
  - `.tmp/execution-control-staging/logs/execution-control.log`
  - `.tmp/execution-control-staging/logs/supervisor-agent-worker.log`
- 如果 `start-execution-control-staging.sh` 在 build 前失败，先直接运行：

```bash
infra/local/staging/preflight-execution-control-staging.sh
```

- preflight 在 `docker buildx imagetools inspect ...` 或 `docker pull ...`
  阶段失败，通常是 Docker Desktop registry/proxy 配置或到 Docker Hub/GHCR
  的网络不可达；先修 Docker registry 访问，或确认 base images 已经缓存后临时设置
  `EXECUTION_CONTROL_STAGING_PREFLIGHT_SKIP_REGISTRY=1`
- 再直接执行：

```bash
cd <repo-root>
COMPOSE_PROJECT_NAME=campus-execution-control-staging \
EXECUTION_CONTROL_HOST_PORT=27051 \
docker compose -f infra/local/docker-compose.execution-control-runtime.yml ps
```

`status --check` 报 `local readyz returned HTTP ...`

- 说明 `execution-control` 或 `supervisor-agent-worker` 还没达到真实 runtime ready
- 先跑：

```bash
uv run --all-packages python -m scripts.doctor_env execution-control --json
```

- 再看 `supervisor-agent-worker.log` 中缺的是 prompt runtime、HTTP pool 还是 worker runtime

真实 chat smoke 返回 `supervisor_unavailable`，且 `supervisor-agent-worker.log` 中出现
`QDRANT_URL is required`

- 说明 transport ready，但 query runtime env 没有进入 Docker runtime
- 先确认容器里变量存在：

```bash
docker exec campus-execution-control-staging-supervisor-agent-worker-1 \
  sh -lc 'for k in QDRANT_URL DOCUMENT_REGISTRY_DATABASE_URL \
  EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET EMBEDDING_MODEL; do \
  eval v=\${$k:-}; [ -n "$v" ] && echo "$k=set" || echo "$k=unset"; done'
```

execution audit 不出现在 panel 审计时间线

- 先看 `execution-control` 的 `/readyz` 中 `execution_audit_runtime`
- 再看 `/metrics`：

```bash
curl -sS http://127.0.0.1:27051/metrics | grep execution_audit
```

- staging lifecycle 会优先读取显式 `EXECUTION_CONTROL_EXECUTION_AUDIT_*`
  变量；未显式配置时，会从 `EXECUTION_CONTROL_STAGING_APP_API_BASE_URL` 与
  `APP_API_INTERNAL_SHARED_SECRET` 派生 internal ingest URL 和 shared secret
- 如果 emitted 增加但 panel 未出现，检查 `app-api` scheduled projector drain；
  internal ingest 成功时也会触发 request-scoped drain，cron 只承担周期性一致性检查

- 如果变量缺失，重新执行：

```bash
infra/local/staging/stop-execution-control-staging.sh
infra/local/staging/start-execution-control-staging.sh
```

`status --check` 报 machine ingress request 被拒绝或 origin 不可达

- 先确认 Cloudflare DNS record 指向当前 staging VM，且 proxied 状态开启
- 再确认 Access application 绑定
  `execution-control-staging.mucwiki-edge.link`，policy 只允许 service token
- VM 上确认 Caddy/Nginx 正在监听 `443`，并只反代到 `127.0.0.1:27051`
- 如果未带 Access token 请求返回 `200`，这是 Access policy blocker，不能继续标绿
- 如果带 Access token 但缺 `x-worker-origin-auth` 返回 `200`，这是 execution-control auth
  blocker，不能继续标绿

`status --check` 报 `app-api readyz ...`

- 说明本地 execution-control runtime 可能健康，但 shared staging `app-api`
  自身或它到 supervisor 的依赖不健康
- 直接检查：

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
```

- 如果只有 `executionControl` 或 `executionRuntime` 失败，先确认 app-api staging
  已配置 `EXECUTION_CONTROL_ACCESS_CLIENT_ID`、
  `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET` 与 `EXECUTION_CONTROL_SHARED_SECRET`，
  再回到这份 runbook 的冷启动恢复流程

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

### Worker Autoscaler Dry-Run Evidence

本轮 staging 不要求 autoscaler 真实扩缩容容器或 Pod，但上线证据必须证明它只读
Temporal task queue / downstream budget observation，并只写 desired replica evidence。

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
      "name": "campus-agent.activity.rag",
      "role": "rag",
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

通过标准：

- `mode="dry_run"`
- `writes_execution_state=false`
- 每个 observed queue 都有 desired replica decision
- evidence 不包含 workflow/run/step/event/terminal state write 表述
- 该命令不得写 PG projection、Temporal workflow history 或 downstream budget

## Recovery Boundary

当前 active recovery path 是重启 `execution-control + supervisor-agent-worker` 双容器 runtime。
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
infra/local/staging/status-execution-control-staging.sh --check
```

Do not use this command to bypass a failed ingestion release. If Qdrant payload
metadata or the native snapshot sidecar is inconsistent, rebuild or restore the
affected release instead.
