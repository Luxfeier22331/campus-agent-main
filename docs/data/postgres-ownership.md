---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-03-30
updated: 2026-07-05
---
# Shared Postgres Ownership

## 文档边界

这份文档冻结 repo root `CAMPUS_SHARED_POSTGRES_URL` 指向的共享 Supabase Postgres 的
ownership、逻辑 schema 划分与当前可重建 schema 规则。

它补充但不替代以下文档：

- `app-api` 逻辑 schema：`docs/data/app-api/README.md`
- `official_web` shared data schema：`docs/data/app-api/official-web.md`
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

同时允许一个只服务于 offline operator / schema bootstrap / DBA 路径的 companion key：

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

- `app_auth.*` repo-owned Better Auth truth；runtime 与 current schema bootstrap
  owner 都是 `apps/app-api`
- `chat.*` consumer conversation/message truth；product-layer owner 与 shared-db
  bootstrap owner 都是 `apps/app-api`
- `runtime.*` request command-side ledger / outbox；owner 是 `apps/app-api`
- `operator.*` panel/read-model projections；owner 是 `apps/app-api`
- `official_web.*` crawl-run ledger、page observation、freshness 与 target workset
  durable truth；runtime writer owner 是 `apps/ingestion-control`。`apps/app-api`
  只消费 operator projection/read surface 与 operator release-gate command ledger。
- `ingestion_registry.*` 或其他 ingestion task / document / raw asset registry
  truth；runtime owner 是 `apps/ingestion-control`。Runtime-neutral DTO /
  parser / canonical artifact helper 归 `packages/ingest-core`；Python 不拥有
  registry connection 或 migration truth。

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

## Current Schema Bootstrap Rules

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
- `apps/app-api` 负责当前 app-facing schema baseline：
  - `apps/app-api/drizzle/0000_current_baseline.sql` 是新数据库的 Drizzle baseline；
    后续 `apps/app-api/drizzle/*.sql` 是现有数据库的增量迁移。
  - `apps/app-api/db/shared-product-schema/chat_current.sql` 是
    shared-product `chat.*` current bootstrap artifact。
  - `drizzle.app_api_migrations` 只记录 app-api Drizzle migration chain，不与
    shared-product SQL baseline 混用同一 journal 语义。
- `official_web.*` 的 collector control-plane writer owner 是
  `apps/ingestion-control`，不得新增 app-api collector write route 或 app-api-owned
  run admission ledger。`apps/app-api` 只保留 operator read/projection 与
  release-gate command ledger 所需的 query/type surface。
- `apps/ingestion-control` 不接管 `app-api` 的 Drizzle migration journal；
  ingestion task / registry / closeout tables 由 ingestion-control 代码路径负责
  schema ensure。需要 full current-scope replay / chunk-prep / release 这类
  offline operator 操作时，显式消费 `CAMPUS_SHARED_POSTGRES_OPERATOR_URL`。
  Python 不创建 ingestion Postgres client，也不拥有 registry table migration。
- app-api migration 使用 direct management connection 在 Worker rollout 前执行；
  Hyperdrive 与 long-running Worker 不承担 migration ownership。

## Journal Ownership

共享库中不同 migration owner 不得共享同一张 migration journal table。

当前接受：

- `apps/app-api` 使用 `drizzle.app_api_migrations`

这意味着：

- `app-api` 不再使用默认 `drizzle.__drizzle_migrations`
- 以后若其他 owner 引入 Drizzle，也必须使用自己的独立 journal table

## Existing Database Handling

当某个环境已经存在部分 schema 但还没有接受当前 repo baseline 时：

- 默认处理方式是备份后重建到 current baseline，而不是在产品代码中保留迁移接管逻辑。
- 如果未来出现不可重建的正式生产数据库，必须通过新的 ADR/runbook 接受一次性迁移计划，
  并在迁移完成后删除迁移脚本、测试和文档入口。
- 不允许把“不确定是否一致”的共享库直接标记为已迁移
- 发现结构不一致时必须 fail closed，而不是自动 destructive 修复
