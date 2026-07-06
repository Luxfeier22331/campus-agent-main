---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-03-30
updated: 2026-04-12
---
# Shared Postgres Ownership

## 文档边界

这份文档冻结 repo root `CAMPUS_SHARED_POSTGRES_URL` 指向的共享 Supabase Postgres 的
ownership、逻辑 schema 划分与迁移接管规则。

它补充但不替代以下文档：

- `app-api` 逻辑 schema：`docs/data/app-api/README.md`
- `official_web` control-plane schema：`docs/data/app-api/official-web.md`
- `app-api`
  runtime/ownership：`docs/architecture/system/product-runtime.md`
- env ownership：`docs/environment/README.md`

这份文档不冻结：

- 具体 Supabase project / region
- connection pooler host
- 对象存储与 Qdrant 细节
- ingestion collection 级别的 raw/chunk/index policy
- staging / production 的当前部署状态

## Ownership 与连接姿态说明

这份文档冻结的是 repo 共享 Postgres 的 ownership、env 命名与 connectivity posture。

它不承担：

- 当前环境是否已经部署完成
- 某个 worktree 的数据库迁移执行现场
- 某条 feature/wave 的 closeout 状态说明

判断当前环境执行状态时，应以 `.planning/PROJECT.md`、
`.planning/WORKSTREAMS.md`、相关 runbook 与实际代码为准。本地会话状态由
GSD SDK / Codex native session 承接，不再写回 tracked workstream state file。

## 核心结论

repo 当前接受一份共享 Supabase Postgres，作为多个 runtime/data-plane owner 共用的关系型存储底座。

repo root `.env` 的 canonical runtime key 固定为：

- `CAMPUS_SHARED_POSTGRES_URL`

同时允许一个只服务于 offline operator / migration / DBA 路径的 companion key：

- `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`

这表示：

- 它是 repo 共享 Postgres truth，不是某个 app 的专属数据库
- app-local env 可以显式填写同一数据库的 owner-specific DSN，但不得反向把
  app-local DSN 重新写成 repo shared truth，也不得通过 repo 脚本批量 fan out
- domain-specific database env 名称只保留为显式 override，不再承载“共享库 canonical name”语义

## Connectivity Posture

共享 Postgres 的长期连接规则见
`docs/decisions/adr-0029-ipv4-session-pooler-postgres-connectivity.md`。

当前 accepted posture 固定为：

- repo-owned persistent runtime 默认按 `IPv4-only` 处理
- `CAMPUS_SHARED_POSTGRES_URL` 在 Supabase-backed runtime 下默认指向 `session pooler`
- `CAMPUS_SHARED_POSTGRES_OPERATOR_URL` 是 canonical operator lane，当前默认指向 IPv4
  可达的 session pooler `:5432`
- runtime 主链路不在 `direct connection` 与 `session pooler` 之间做自动切换
- 长驻 Python / Node runtime 必须使用 application-side pooling，而不是每次数据库操作新建连接

因此这份文档冻结的是 shared Postgres ownership，不再把“连接方式由各命令临时选择”视为允许形态。

## 逻辑 Schema Ownership

当前共享库允许以下 repo-owned schema 共存：

- `app_auth.*` repo-owned Better Auth truth；runtime 与 shared-product bootstrap
  owner 都是 `apps/app-api`
- `chat.*` consumer conversation/message truth；product-layer owner 与 shared-db
  bootstrap owner 都是 `apps/app-api`
- `runtime.*` request command-side ledger / outbox；owner 是 `apps/app-api`
- `operator.*` panel/read-model projections；owner 是 `apps/app-api`
- `official_web.*` crawl-run control-plane durable truth；owner 是 `apps/app-api`
- `ingestion_registry.*` 或其他 registry tables offline document/raw asset registry
  truth；owner 是 `packages/ingestion-core` / `apps/ingestion-control`

## Env Ownership Rules

- repo root `.env` / `.env.example` 持有 `CAMPUS_SHARED_POSTGRES_URL` 与 canonical
  `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`
- app-local env 只持有当前 app runtime 直接消费的 database URL，例如：
  - `apps/app-api/.env` ->
    `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB` /
    `APP_API_OPERATOR_DATABASE_URL`
- domain override env 例如
  `DOCUMENT_REGISTRY_DATABASE_URL`、`RAW_ASSET_REGISTRY_DATABASE_URL`，只在对应 owner
  明确偏离共享库时使用

## Migration / Bootstrap Rules

- Supabase platform-managed `auth.*` 保留给 Supabase Auth；repo 不接管，也不把它当成 Better
  Auth 的物理 schema
- `app_auth.*` on Supabase session pooler shared-product bootstrap 仍通过数据库角色默认
  `search_path=app_auth, public, extensions` 收敛；仅靠连接字符串 `options=-c
  search_path=...` 在当前 shared DB 上不可靠，而 `apps/app-api` runtime 现已改为通过 Drizzle
  adapter + schema-qualified metadata 访问 `app_auth.*`
- deployed Worker runtimes 远端 Worker 环境会重新缓存静态 Worker/app assembly，但不会跨请求复用
  repo-local `pg.Pool` / Drizzle runtime handle / Better Auth runtime
  state；Hyperdrive 负责底层连接复用，而 app runtime 只在单次 request scope 内持有 client state
- deployed `app-api` runtime Hyperdrive lanes `APP_API_DB` 继续承接
  cached/read-mostly queries；`APP_API_DB_FRESH` 只承接 Better Auth、provider
  config、dining operations、chat command conversation-context admission 与 chat
  conversation detail read-after-write verification 这类显式白名单的
  read-after-write-sensitive product paths，并要求在
  Cloudflare 侧关闭 SQL response caching，避免 `sign-up` / command write 后立刻读回时命中
  stale negative cache。它不是第二个数据库，也不是默认 command lane。
- `apps/app-api` 负责 shared-product bootstrap 下的 `app_auth.*` / `chat.*`，并拥有
  `runtime.*` / `operator.*` / `official_web.*` 的 Drizzle migration
  ownership；`drizzle.app_api_migrations` 不接管 `app_auth.*` / `chat.*`
- `packages/ingestion-core` 不接管 `app-api` 的 Drizzle migration journal；registry
  table 仍由自身代码路径负责 schema ensure。需要 full current-scope replay / chunk-prep /
  release 这类 offline operator 操作时，显式消费
  `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`

## Journal Ownership

共享库中不同 migration owner 不得共享同一张 migration journal table。

当前接受：

- `apps/app-api` 使用 `drizzle.app_api_migrations`

这意味着：

- `app-api` 不再使用默认 `drizzle.__drizzle_migrations`
- 以后若其他 owner 引入 Drizzle，也必须使用自己的独立 journal table

## Adoption Rules

当共享库已经存在部分 schema 但没有 `app-api` migration journal 时：

- 必须先做 inventory / schema validation
- 只允许在对象结构与 repo baseline 一致时写入 `app-api` migration journal
- 不允许把“不确定是否一致”的共享库直接标记为已迁移
- 发现结构不一致时必须 fail closed，而不是自动 destructive 修复
