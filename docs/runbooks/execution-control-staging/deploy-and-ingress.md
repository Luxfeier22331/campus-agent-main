---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-13
updated: 2026-06-15
---

# Execution Control Staging Deploy And Ingress

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

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
- `APP_API_STAGING_SMOKE_AUTH_SECRET` 或 `STAGING_APP_API_SMOKE_AUTH_SECRET`；供
  `pnpm --dir apps/app-api chat:e2e:staging` 等 staging smoke wrapper 在 canonical
  deploy checkout 内铸造受控 smoke session。wrapper 默认读取本文件，只有该
  ops-owned file 缺失时才回退到 repo-local staging env，canonical
  `nc-arm-6c` 不允许使用该回退。
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
- canonical self-host Qdrant 不需要在 `runtime.env` 手写 URL 或 key；lifecycle 默认投影
  `QDRANT_URL=http://qdrant:6333`，首次生成 `QDRANT_API_KEY` 与
  `QDRANT_READ_ONLY_API_KEY`，并把 read-only key 注入 online runtime
  `QDRANT_QUERY_API_KEY`。
- 只有外接 / 非 canonical Qdrant endpoint 时才填写 `STAGING_INGESTION_QDRANT_URL`。
  跨 substrate 或公网入口必须使用 HTTPS + CA；同一 compose network 内的
  `http://qdrant:6333` 是 accepted internal service DNS。
- personal memory 使用 self-hosted Hindsight。`start-execution-control-staging.sh` 会在启动
  execution-control 前执行 Hindsight runtime check，并写出
  `personal-memory-runtime-install.json` / `personal-memory-runtime-check.json`
  evidence；`status-execution-control-staging.sh --check` 会要求
  `/readyz.personal_memory_runtime.healthy=true`。staging lifecycle 默认投影
  `PERSONAL_MEMORY_BASE_URL=http://hindsight-api:8888`，并在 runtime dir 下首次生成并
  持久化 `PERSONAL_MEMORY_API_SECRET`、`PERSONAL_MEMORY_OWNER_SALT` 与
  `HINDSIGHT_POSTGRES_PASSWORD`；开发者不需要手工填写这些内部 Hindsight 值。
  Hindsight runtime、timeout 与 recall limits 来自
  `/etc/campus-agent/runtime-profile.staging.json`，不是 staging env knobs。
- staging 不消费 `infra/local/.generated/runtime.env`。Hindsight Postgres password 来自
  staging runtime generated secrets file；Hindsight LLM 与 embedding provider env 来自
  staging provider projection artifact 中的 `hindsight_llm` 与 `hindsight_embedding`
  profiles，不使用 root provider env fallback，也不使用 retired `memory_graph_llm` role。
  `HINDSIGHT_API_RERANKER_PROVIDER` 当前固定为 `rrf`。
- canonical lifecycle 会在 `execution_control_staging_load_env` 开始时检查 provider
  projection artifact；如果缺失，会使用 ops-owned `runtime.env` 中的
  `APP_API_INTERNAL_SHARED_SECRET` 和 app-api staging internal provider-config endpoint
  原子生成 `${EXECUTION_CONTROL_STAGING_RUNTIME_DIR:-.tmp/execution-control-staging}/provider-config-projection.json`
  后再投影 Hindsight / execution-control runtime env。不要手工复制旧 projection 文件到 repo。
- `STAGING_INGESTION_EMBEDDING_BASE_URL` 与
  `STAGING_INGESTION_EMBEDDING_API_KEY` 只提供 indexing provider endpoint/key。
  embedding model、dimensions、sparse profile 与 vector binding 由
  `configs/ingestion/<corpus>/<collection>/runtime-profile.json` 持有，并必须与当前
  query-serving index release metadata 匹配。
- `STAGING_ACCESS_TEAM_DOMAIN=https://<current-access-team-domain>.cloudflareaccess.com`
- `STAGING_ACCESS_POLICY_AUD=<operator-console-staging Access aud>`
- `EXECUTION_CONTROL_METRICS_BEARER_TOKEN` 与
  `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET` 不需要手写；lifecycle 首次生成并
  持久化到 runtime secrets file。
- `DEPLOYMENT_ENVIRONMENT=staging` 与
  `EXECUTION_CONTROL_RUNTIME_RELEASE=execution-control@<deploy git sha>` 由 lifecycle
  投影；runtime profile 启用 OTel 时缺少 release identity 会 fail closed。
- canonical self-host run projection store 默认投影为
  `postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable`。
  只有外接 Postgres 时才填写 `EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL`。

以下 internal agent-runtime link env 不需要在 canonical `runtime.env` 手写；staging
`execution_control_staging_load_env` 会在部署/start/preflight/status 时投影：

- `EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL=http://agent-runtime:27062`
- `EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET` 与 `AGENT_RUNTIME_SHARED_SECRET`；
  如未显式覆盖，loader 会从 `EXECUTION_CONTROL_SHARED_SECRET` 和
  `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET` 派生同一 shared secret，并同时注入
  execution-control 与 agent-runtime 进程。
- `AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL=http://execution-control:8000`
- `AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET`；默认等于
  `EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET`，供 primary agent runtime typed
  tool executor 调用 execution-control internal query endpoints。

只有使用非 canonical topology（例如 systemd / 本机进程而不是 compose network）时，才应
在 ops-owned runtime env 或同等 deployment secret source 覆写这些 internal bridge 地址；
缺失投影时应视为部署脚本 / env projection bug，而不是要求未部署用户手动配置。

- Temporal runtime 默认由 lifecycle 投影；以下地址 / identity 不需要在 canonical
  `runtime.env` 手写，password 与 workflow id salt 首次生成并持久化：
  - `TEMPORAL_POSTGRES_PASSWORD`
  - `EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233`
  - `EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging`
  - `EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow`
  - `EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=staging:workflow-worker:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_CORE_WORKER_IDENTITY=staging:activity-core:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY=staging:activity-agent:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY=staging:activity-knowledge:<instance>`
  - `EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT`
  - `EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000`
  缺任一投影值时，lifecycle 必须 fail closed，并作为 env projection bug 处理。
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
generic `EMBEDDING_*` 不能替代 staging 的
`STAGING_INGESTION_EMBEDDING_BASE_URL` / `STAGING_INGESTION_EMBEDDING_API_KEY`。
模型、维度与 sparse runtime profile 不能通过 env 覆盖。
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
- app-api runtime secrets；retrieval data-plane、object-store 与 execution-control
  compose runtime env 不放在这里，统一由 ops-owned `runtime.env` 的
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
