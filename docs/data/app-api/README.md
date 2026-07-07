---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-03-28
updated: 2026-06-13
---

# App API Schema

## Document Boundary

This file is the stable index for app-api logical schema ownership. It
owns global rules, code ownership and migration rules only. Table-family
details live in split data documents.

## Split Documents

- `app-api/auth-chat-docs-profile.md`
  - Auth, chat, docs and profile: app auth, chat, docs and memory tables
- `app-api/runtime.md`
  - Runtime: request execution and runtime projection tables
- `app-api/operator.md`
  - Operator: operator projection, audit, metric and quality tables
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
- Supabase platform-managed `auth.*` 不属于 repo-owned app schema

`apps/app-api` 当前运行时直接消费的逻辑分域：

- `campus_services_ops.*`
- `app_auth.*`
- `chat.*`
- `runtime.*`
- `operator.*`
- `official_web.*`
- `docs.*`
- `profile.*`
- `identity.*`
- `dining.*`

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
- `official_web` shared data schema 单独冻结在
  `docs/data/app-api/official-web.md`；当前 collector control-plane writer owner
  是 `apps/ingestion-control`，`apps/app-api` 只拥有 operator read/projection 与
  release-gate operator ledger。
- 本文继续只覆盖当前 browser-facing app surfaces、request projection 基线与 app-api
  owned operator projections；source-channel 专用 schema 另见各 domain data contract

## Global Rules

- 所有业务主键使用 opaque text id；不要把自增整数暴露成长期 API 依赖
- `chat.*` 是 consumer UX truth，不是 operator request truth
- `operator.*` 是 panel read model，不是 chat history truth
- `runtime.*` 是 request command-side truth 与 projection input truth
- 第一版不单独建立 operator end-user 用户系统表
- 本索引不冻结物理拆库、托管商、Drizzle migration 文件名、
  Better Auth adapter 的全部 SQL 细节或 source-channel 专用 schema

## Schema Code Ownership

`apps/app-api` 的数据库代码组织固定为：

- `app_auth.*`
- `campus_services_ops.*`
- `chat.*`
- `runtime.*`
- `operator.*`
- `docs.*`
- `profile.*`
- `identity.*`
- `dining.*`

历史 app-api Drizzle baseline 中包含 `official_web.*`，但它不再表示 app-api 是
collector control-plane writer owner；具体规则另见
`docs/data/app-api/official-web.md`。

`campus_services_ops.*` 的表级 shape 另见
`docs/data/campus-services-ops.md`。

`identity.*` 的表级 shape 另见
`docs/data/identity-platform.md`。

`dining.*` 的表级 shape 另见
`docs/data/dining.md`。

它们共享：

- 一套 Drizzle schema codebase
- 一套 runtime type 定义与 query helpers

但 migration ownership 已显式拆分为：

- `apps/app-api` 的 `drizzle.app_api_migrations` 拥有 `runtime.*` / `operator.*` /
  `docs.*` / `profile.*` / `identity.*` / `dining.*`
- `official_web.*` 的 collector control-plane durable writes 由
  `apps/ingestion-control` 执行；app-api schema export 只服务历史 migration
  baseline、operator projection 和 query/type safety，不得恢复 collector write path
- `apps/app-api` shared-product bootstrap 负责 `app_auth.*` / `chat.*` 的 bootstrap
  / adoption，不与 `drizzle.app_api_migrations` 混用同一 ownership 语义

这意味着：

- `apps/app-api` 运行时仍可通过统一 schema codebase 访问 `app_auth.*` / `chat.*`
- 但不能再把 `app_auth.*` / `chat.*` 误写成 `app-api` Drizzle migration ownership
- 可以按模块分文件组织 schema，但 bootstrap/adoption owner 与 Drizzle migration owner 都必须保持显式

## Migration Rules

- Better Auth 相关表与 app-domain 表共享同一条 Drizzle migration pipeline
- app-domain 第一波 migration 至少包含 `chat.*`、`runtime.*`、`operator.*`
- Worker runtime 使用 Hyperdrive；migration 命令不通过 Hyperdrive 执行
- migration / drift check / schema inspection 使用 direct database management
  connection
- 允许第一版单库共存，但禁止把 schema separation 退化成无边界的大表堆
