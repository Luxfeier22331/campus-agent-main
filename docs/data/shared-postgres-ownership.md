---
doc_type: data
status: active
created: 2026-03-30
updated: 2026-03-30
---

# Shared Postgres Ownership

## 文档边界

这份文档冻结 repo root `CAMPUS_SHARED_POSTGRES_URL` 指向的共享 Supabase Postgres 的 ownership、逻辑 schema 划分与迁移接管规则。

它补充但不替代以下文档：

- `app-api` 逻辑 schema：`docs/data/app-api-schema.md`
- `official_web` control-plane schema：`docs/data/app-api-official-web-schema.md`
- `app-api` runtime/ownership：`docs/architecture/app-api-architecture.md`
- env ownership：`docs/environment/README.md`

这份文档不冻结：

- 具体 Supabase project / region
- connection pooler host
- 对象存储与 Qdrant 细节
- ingestion collection 级别的 raw/chunk/index policy

## 核心结论

repo 当前接受一份共享 Supabase Postgres，作为多个 runtime/data-plane owner 共用的关系型存储底座。

repo root `.env` 的 canonical key 固定为：

- `CAMPUS_SHARED_POSTGRES_URL`

这表示：

- 它是 repo 共享 Postgres truth，不是某个 app 的专属数据库
- app-local env 可以从它 fan out，但不得反向把 app-local DSN 重新写成 repo shared truth
- domain-specific database env 名称只保留为显式 override，不再承载“共享库 canonical name”语义

## 逻辑 Schema Ownership

当前共享库允许以下 repo-owned schema 共存：

- `app_auth.*`
  repo-owned Better Auth truth；runtime 与 shared-product bootstrap owner 都是 `apps/app-api`
- `chat.*`
  consumer conversation/message truth；product-layer owner 与 shared-db bootstrap owner 都是 `apps/app-api`
- `runtime.*`
  request command-side ledger / outbox；owner 是 `apps/app-api`
- `operator.*`
  panel/read-model projections；owner 是 `apps/app-api`
- `official_web.*`
  crawl-run control-plane durable truth；owner 是 `apps/app-api`
- `ingestion_registry.*` 或其他 registry tables
  offline document/raw asset registry truth；owner 是 `packages/ingestion-core` / `apps/ingestion-worker`

## Env Ownership Rules

- repo root `.env` / `.env.example`
  持有 `CAMPUS_SHARED_POSTGRES_URL`
- app-local env
  只持有当前 app runtime 直接消费的 database URL，例如：
  - `apps/app-api/.env` -> `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB` / `APP_API_MANAGEMENT_DATABASE_URL`
- domain override env
  例如 `DOCUMENT_REGISTRY_DATABASE_URL`、`RAW_ASSET_REGISTRY_DATABASE_URL`，只在对应 owner 明确偏离共享库时使用

## Migration / Bootstrap Rules

- Supabase platform-managed `auth.*`
  保留给 Supabase Auth；repo 不接管，也不把它当成 Better Auth 的物理 schema
- `app_auth.*` on Supabase session pooler
  通过数据库角色默认 `search_path=app_auth, public, extensions` 收敛；仅靠连接字符串 `options=-c search_path=...` 在当前 shared DB 上不可靠
- `apps/app-api`
  负责 shared-product bootstrap 下的 `app_auth.*` / `chat.*`，并拥有 `runtime.*` / `operator.*` / `official_web.*` 的 Drizzle migration ownership；`drizzle.app_api_migrations` 不接管 `app_auth.*` / `chat.*`
- `packages/ingestion-core`
  不接管 `app-api` 的 Drizzle migration journal；registry table 仍由自身代码路径负责 schema ensure

## Journal Ownership

共享库中不同 migration owner 不得共享同一张 migration journal table。

当前接受：

- `apps/app-api` 使用 `drizzle.app_api_migrations`

这意味着：

- `app-api` 不再使用默认 `drizzle.__drizzle_migrations`
- 以后若其他 owner 引入 Drizzle，也必须使用自己的独立 journal table

## Adoption Rules

当共享库已经存在部分 schema 但没有 `app-api` migration journal 时：

- 必须先做 inventory / compatibility validation
- 只允许在对象结构与 repo baseline 一致时写入 `app-api` migration journal
- 不允许把“不确定是否一致”的共享库直接标记为已迁移
- 发现结构不一致时必须 fail closed，而不是自动 destructive 修复
