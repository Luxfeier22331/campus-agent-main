---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-03-28
updated: 2026-06-13
---

# App API Schema

<!-- markdownlint-disable MD013 -->

## Document Boundary

This file is the stable index for app-api logical schema ownership. It
owns global rules, code ownership and migration rules only. Table-family
details live in split data documents.

## Split Documents

- `app-api-schema/auth-chat-docs-profile.md`
  - Auth, chat, docs and profile: app auth, chat, docs and memory tables
- `app-api-schema/runtime.md`
  - Runtime: request execution and runtime projection tables
- `app-api-schema/operator.md`
  - Operator: operator projection, audit, metric and quality tables
- `identity-platform-schema.md`
  - App-owned identity product schema; separate from Better Auth runtime tables
- `dining-operations-schema.md`
  - Dining draft, floorplan, menu, release candidate, release and audit schema

## Index-Owned Baseline

## 文档边界

这份文档冻结 `apps/app-api` 的逻辑分域、最小表形态、主键与 ownership 规则。

它补充但不替代以下文档：

- `app-api` runtime 与边界：`docs/architecture/system/product-runtime-architecture.md`
- request projection
  ownership：`docs/architecture/system/product-runtime-architecture.md`
- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- `official_web` control-plane schema：`docs/data/app-api-official-web-schema.md`
- identity platform logical schema：`docs/data/identity-platform-schema.md`
- dining operations logical schema：`docs/data/dining-operations-schema.md`
- authenticated notice processing operator
  contract：`docs/contracts/app-api-authenticated-notice-processing-http.md`

这份文档不冻结：

- 物理拆库
- 具体托管商
- Drizzle migration 文件名
- Better Auth adapter 的全部 SQL 细节
- `official_web` control-plane 的额外逻辑分域

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
  `docs/data/identity-platform-schema.md`; current `app_auth.*` Better Auth
  runtime tables must not be treated as the product account model.
- `dining.*` product/ops schema is governed by
  `docs/data/dining-operations-schema.md`; published dining student projection
  reads release snapshots, not mutable draft rows.

补充说明：

- `campus_services_ops.*` 是 `campus_services` 人工校对、override draft、release
  snapshot 与 audit event 的 app-api owned ops schema；它不保存 raw notice/chat evidence，也不
  替代 execution-control typed runtime read model。
- `official_web` control-plane 引入的额外逻辑分域单独冻结在
  `docs/data/app-api-official-web-schema.md`
- 本文继续只覆盖当前 browser-facing app surfaces、request projection 基线与 app-api
  owned operator projections；source-channel 专用 schema 另见各 domain data contract

## Global Rules

- 所有业务主键使用 opaque text id；不要把自增整数暴露成长期 API 依赖
- `chat.*` 是 consumer UX truth，不是 operator request truth
- `operator.*` 是 panel read model，不是 chat history truth
- `runtime.*` 是 request command-side truth 与 projection input truth
- 第一版不单独建立 operator end-user 用户系统表

## Schema Code Ownership

`apps/app-api` 的数据库代码组织固定为：

- `app_auth.*`
- `campus_services_ops.*`
- `chat.*`
- `runtime.*`
- `operator.*`
- `official_web.*`
- `docs.*`
- `profile.*`
- `identity.*`
- `dining.*`

`official_web` control-plane 落地时，可以在保持同一 migration pipeline 的前提下新增
`official_web.*`；具体规则另见 `docs/data/app-api-official-web-schema.md`。

`campus_services_ops.*` 的表级 shape 另见
`docs/data/campus-services-ops-source-truth-schema.md`。

`identity.*` 的表级 shape 另见
`docs/data/identity-platform-schema.md`。

`dining.*` 的表级 shape 另见
`docs/data/dining-operations-schema.md`。

它们共享：

- 一套 Drizzle schema codebase
- 一套 runtime type 定义与 query helpers

但 migration ownership 已显式拆分为：

- `apps/app-api` 的 `drizzle.app_api_migrations` 拥有 `runtime.*` / `operator.*` /
  `official_web.*` / `docs.*` / `profile.*` / `identity.*` / `dining.*`
- `apps/app-api` shared-product bootstrap 负责 `app_auth.*` / `chat.*` 的 bootstrap
  / adoption，不与 `drizzle.app_api_migrations` 混用同一 ownership 语义

这意味着：

- `apps/app-api` 运行时仍可通过统一 schema codebase 访问 `app_auth.*` / `chat.*`
- 但不能再把 `app_auth.*` / `chat.*` 误写成 `app-api` Drizzle migration ownership
- 可以按模块分文件组织 schema，但 bootstrap/adoption owner 与 Drizzle migration owner 都必须保持显式

## Ownership Notes

### Chat Ownership

- `chat.conversations`
- `chat.messages`
- `chat.message_feedback`

只服务：

- online answer UX
- current-user history
- answer quality feedback

不服务：

- operator request list/detail
- authorization、routing、memory 或 supervisor admission

### Runtime Ownership

- `runtime.request_execution`
- `runtime.projection_outbox`
- `runtime.request_observability_fact`

只服务：

- command-side truth
- idempotency
- projection input

### Operator Ownership

- `operator.request_projection`
- `operator.request_audit_projection`
- `operator.metric_rollup`
- `operator.quality_badcase_projection`
- `operator.quality_grade_projection`
- `operator.trace_backlink_projection`
- `operator.authenticated_notice_processing_projection`
- `operator.authenticated_notice_processing_event_projection`
- `operator.authenticated_notice_run_processing_projection`
- `operator.authenticated_notice_run_processing_event_projection`

只服务：

- panel list/detail
- panel audit timeline
- panel aggregate / timeseries
- panel quality badcase queue
- panel sampled grade summary
- panel-safe trace / issue deep links
- panel authenticated notice processing status / timeline
- panel authenticated notice run processing status / timeline
- pagination / filtering / detail view

不服务：

- replay execution
- chat history
- raw sink explorer

## Migration Rules

- Better Auth 相关表与 app-domain 表共享同一条 Drizzle migration pipeline
- app-domain 第一波 migration 至少包含 `chat.*`、`runtime.*`、`operator.*`
- Worker runtime 使用 Hyperdrive；migration 命令不通过 Hyperdrive 执行
- migration / drift check / schema inspection 使用 direct database management
  connection
- 允许第一版单库共存，但禁止把 schema separation 退化成无边界的大表堆
