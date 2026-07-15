---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-03-28
updated: 2026-07-08
---

# App API Schema

## Document Boundary

This file is the app-api logical schema owner overview. It owns shared storage,
schema-code and migration-ownership rules for app-api data domains. Table-family
field details live in split data documents.

## Owner Documents

- `app-api/auth-chat-docs-profile.md`
  - Auth, chat, docs and profile: app auth, chat, docs and memory tables
- `app-api/runtime.md`
  - Runtime: request observability projection
- `app-api/operator.md`
  - Operator ingestion API projection consumed from ingestion-control
- `identity-platform.md`
  - App-owned identity product schema; separate from Better Auth runtime tables
- `dining.md`
  - Dining draft, floorplan, menu, release candidate, release and audit schema

## Storage Conclusion

第一版接受：

- 单个 Postgres
- Worker runtime 通过 Hyperdrive 访问数据库
- migration / schema 管理通过 direct database management connection 访问数据库
- 逻辑 schema 分域而不是物理拆库
- 这份 Postgres 是 repo 共享数据库，不是 `apps/app-api` 独占实例
- `app_auth.*` 是唯一 repo-owned browser authentication schema

`apps/app-api` 当前运行时直接消费的逻辑分域：

- `campus_services_ops.*`
- `app_auth.*`
- `chat.*`
- `runtime.*`
- `docs.*`
- `profile.*`
- `identity.*`
- `dining.*`
- `observability.*`
- `provider_config.*`

已冻结并 materialized 的 app-owned product schema：

- `identity.*` product schema is governed by
  `docs/data/identity-platform.md`; current `app_auth.*` Better Auth
  runtime tables must not be treated as the product account model.
- `dining.*` product/ops schema is governed by
  `docs/data/dining.md`; published dining student projection
  reads release snapshots, not mutable draft rows.

补充说明：

- `campus_services_ops.*` 是 `campus_services` 人工校对、override draft、release
  snapshot 与 audit event 的 app-api owned ops schema；它不保存 raw notice/chat evidence，也不
  替代 execution-control typed runtime read model。
- offline source-channel data belongs to ingestion-control/object storage and
  is not part of the app-api schema.
- operator ingestion routes consume the bounded `ingestion_control.tasks`
  projection through ingestion-control; app-api owns no `operator.*` schema.
- 本文继续只覆盖 browser-facing app surfaces、chat dispatch 事实与 app-api-owned
  product/operation configuration；source-channel 专用 schema 另见各 domain data contract

## Global Rules

- 所有业务主键使用 opaque text id；不要把自增整数暴露成长期 API 依赖
- `chat.*` 是 conversation、message 与 turn dispatch truth
- app-api 在 `runtime.*` 中只拥有 request observability projection，不拥有 execution run truth
- 第一版不单独建立 operator end-user 用户系统表
- 本索引不冻结物理拆库、托管商、Drizzle migration 文件名、
  Better Auth adapter 的全部 SQL 细节或 source-channel 专用 schema

## Schema Code Ownership

`apps/app-api` 的数据库代码组织固定为：

- `app_auth.*`
- `campus_services_ops.*`
- `chat.*`
- `runtime.*`
- `docs.*`
- `profile.*`
- `identity.*`
- `dining.*`
- `observability.*`
- `provider_config.*`

`campus_services_ops.*` 的表级 shape 另见
`docs/data/campus-services-ops.md`。

`identity.*` 的表级 shape 另见
`docs/data/identity-platform.md`。

`dining.*` 的表级 shape 另见
`docs/data/dining.md`。

它们共享：

- 一套 Drizzle schema codebase
- 一套 runtime type 定义与 query helpers

当前 schema artifact ownership 已显式拆分为：

- `apps/app-api/drizzle/0000_initial.sql` 是 app-api Drizzle 初始
  baseline，覆盖 app-facing product、projection 与 operator surfaces。
- `apps/app-api/db/shared-product-schema/chat_current.sql` 是
  shared-product `chat.*` bootstrap baseline。
- source collector lifecycle and artifacts are absent from app-api schemas;
  app-api reads only the ingestion-control bounded task projection.
- `drizzle.app_api_migrations` 记录 app-api Drizzle migration chain，不与
  shared-product SQL baseline 混用同一 journal 语义。

这意味着：

- `apps/app-api` 运行时仍可通过统一 schema codebase 访问 `app_auth.*` / `chat.*`
- 但不能再把 `app_auth.*` / `chat.*` 误写成 `app-api` Drizzle migration ownership
- 可以按模块分文件组织 schema，但 Drizzle baseline、shared-product SQL baseline 与
  ingestion-control-owned schema ensure 必须保持显式边界。

## Migration Rules

- 新数据库从 `0000_initial.sql` 创建 schema；未来的增量迁移按 journal 顺序执行。
- Better Auth/app-auth 与 chat shared-product bootstrap 使用显式 SQL baseline。
- Worker runtime 使用 Hyperdrive；migration 命令不通过 Hyperdrive 执行
- schema migration / inspection 使用 direct database management connection，并在
  Worker rollout 前完成
- long-running Worker 不执行 schema auto-migration
- 允许第一版单库共存，但禁止把 schema separation 退化成无边界的大表堆
