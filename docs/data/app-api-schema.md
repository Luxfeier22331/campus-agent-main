---
doc_type: data
status: active
created: 2026-03-28
updated: 2026-04-03
---

# App API Schema

## 文档边界

这份文档冻结 `apps/app-api` 的逻辑分域、最小表形态、主键与 ownership 规则。

它补充但不替代以下文档：

- `app-api` runtime 与边界：`docs/architecture/product-runtime-architecture.md`
- request projection ownership：`docs/architecture/product-runtime-architecture.md`
- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`

这份文档不冻结：

- 物理拆库
- 具体托管商
- Drizzle migration 文件名
- Better Auth adapter 的全部 SQL 细节

## Storage Conclusion

第一版接受：

- 单个 Postgres
- Worker runtime 通过 Hyperdrive 访问数据库
- migration / schema 管理通过 direct database management connection 访问数据库
- 逻辑 schema 分域而不是物理拆库
- 这份 Postgres 是 repo 共享数据库，不是 `apps/app-api` 独占实例
- Supabase platform-managed `auth.*` 不属于 repo-owned app schema

`apps/app-api` 当前运行时直接消费的逻辑分域：

- `app_auth.*`
- `chat.*`
- `runtime.*`
- `operator.*`
- `official_web.*`

## Global Rules

- 所有业务主键使用 opaque text id；不要把自增整数暴露成长期 API 依赖
- `chat.*` 是 consumer UX truth，不是 operator request truth
- `operator.*` 是 panel read model，不是 chat history truth
- `runtime.*` 是 request command-side truth 与 projection input truth
- 第一版不单独建立 operator end-user 用户系统表

## Schema Code Ownership

`apps/app-api` 的数据库代码组织固定为：

- `app_auth.*`
- `chat.*`
- `runtime.*`
- `operator.*`
- `official_web.*`

它们共享：

- 一套 Drizzle schema codebase
- 一套 runtime type 定义与 query helpers

但 migration ownership 已显式拆分为：

- `apps/app-api` 的 `drizzle.app_api_migrations`
  只拥有 `runtime.*` / `operator.*` / `official_web.*`
- `apps/app-api` shared-product bootstrap
  负责 `app_auth.*` / `chat.*` 的 bootstrap / adoption，不与 `drizzle.app_api_migrations` 混用同一 ownership 语义

这意味着：

- `apps/app-api` 运行时仍可通过统一 schema codebase 访问 `app_auth.*` / `chat.*`
- 但不能再把 `app_auth.*` / `chat.*` 误写成 `app-api` Drizzle migration ownership
- 可以按模块分文件组织 schema，但 bootstrap/adoption owner 与 Drizzle migration owner 都必须保持显式

## `app_auth.*`

`app_auth.*` 由 Better Auth 拥有。

第一版至少存在以下逻辑表：

- `app_auth.user`
- `app_auth.session`
- `app_auth.account`
- `app_auth.verification`

规则：

- 具体物理表名允许由 Better Auth adapter 决定
- Supabase platform `auth.*` 不是这里的 repo-owned Better Auth schema
- `app-api` runtime 与 shared-product bootstrap 使用 `app_auth.*`，但当前不由 `app-api` Drizzle journal 直接接管
- app-domain migration 不应手写改造 Better Auth 的内部列约定，除非适配器明确支持
- panel operator principal 在 v1 不要求持久化成独立 auth 表

## `chat.conversations`

用途：

- consumer conversation truth

最小列：

- `id`
- `owner_user_id`
- `title`
- `created_at`
- `updated_at`

最小索引：

- `(owner_user_id, updated_at desc)`

规则：

- 只承载 public chat user 的 conversation ownership
- conversation 可以通过显式 draft create 创建，也可以在首轮 `POST /api/chat/requests` 中 lazy create
- 不承载 operator request projection

## `chat.messages`

用途：

- conversation 内的 user / assistant 消息

最小列：

- `id`
- `conversation_id`
- `role`
- `kind` nullable
- `text`
- `created_at`
- `request_id` nullable
- `retryable` nullable

最小索引：

- `(conversation_id, created_at asc)`
- `(request_id)` where `request_id is not null`

`kind` 第一版允许：

- `answer`
- `clarification`
- `no_answer`
- `error`

规则：

- `role=user` 的消息不写 `kind`
- `request_id` 只在 assistant-side message 上出现
- `trace_id` 不强制冗余写进 `chat.messages`

## `runtime.request_execution`

用途：

- command-side durable request truth

最小列：

- `request_id`
- `conversation_id`
- `user_message_id`
- `assistant_message_id` nullable
- `surface`
- `actor_user_id`
- `actor_principal_id`
- `actor_roles_json`
- `actor_departments_json`
- `actor_groups_json`
- `actor_campus_scope` nullable
- `principal_type`
- `principal_label` nullable
- `entitlement_snapshot_id` nullable
- `entitlement_groups_json`
- `visibility_scope` nullable
- `applicability_scope` nullable
- `idempotency_key` nullable
- `request_fingerprint_sha256` nullable
- `trace_id`
- `requested_capability` nullable
- `requested_scope_json` nullable
- `selected_target` nullable
- `status`
- `error_code` nullable
- `question_preview`
- `answer_preview` nullable
- `diagnostics_json` nullable
- `source_doc_ids_json` nullable
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `created_at`
- `updated_at`

最小索引：

- `(conversation_id, started_at desc)`
- `(status, started_at desc)`
- unique `(actor_user_id, idempotency_key)` where `idempotency_key is not null`

`status` 第一版允许：

- `accepted`
- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`

规则：

- 这是 panel request truth 的上游 command-side owner
- 首轮 lazy-create 请求在分配 canonical conversation id 之前，允许用稳定的 new-conversation discriminator 参与 `request_fingerprint_sha256` 计算
- `question_preview` / `answer_preview` 是 projection-friendly 摘要，不要求保存 raw full prompt / raw full answer
- `principal_type` / `principal_label` 是 command-side 落盘后的最小 operator projection metadata；不要再把 raw auth/session snapshot 宽 JSON 写入这里
- `entitlement_snapshot_id` / `entitlement_groups_json` / `visibility_scope` / `applicability_scope` 只保存 app-layer 已收口的最小授权摘要，用于 request projection 与 operator-facing restricted request diagnostics；不要把 raw provider claims、raw cookie、raw session 或宽 auth snapshot 落进这里
- `requested_scope_json` 与 `source_doc_ids_json` 使用结构化 JSON，不把 Python-side payload 原样塞进宽 JSON dump
- `diagnostics_json` 只保存 operator-facing summary diagnostics，例如 resolved policy object、rewritten query、clarification/no-answer reason 与 retrieved title summary；不要写 raw evidence snippet、score 或 backend payload

## `runtime.projection_outbox`

用途：

- command-side 已提交事实到 read-model projector 的边界

最小列：

- `event_id`
- `request_id`
- `event_type`
- `payload_json`
- `occurred_at`
- `available_at`
- `processed_at` nullable
- `attempt_count`
- `last_error` nullable

最小索引：

- `(processed_at, available_at)`
- `(request_id, occurred_at desc)`

第一版 `event_type` 至少允许：

- `request.accepted`
- `request.completed`
- `request.needs_clarification`
- `request.no_answer`
- `request.error`

规则：

- projector 必须按 `event_id` 做幂等消费
- outbox payload 只携带 projection 所需字段，不承担 raw audit dump 角色

## `runtime.request_observability_fact`

用途：

- request-scoped operator observability foundation

最小列：

- `request_id`
- `trace_id`
- `conversation_id`
- `surface`
- `principal_type`
- `entitlement_snapshot_id` nullable
- `policy_projection_version` nullable
- `requested_capability` nullable
- `requested_scope_summary` nullable
- `collection` nullable
- `selected_target` nullable
- `status`
- `error_code` nullable
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `retrieval_attempted` nullable
- `candidate_count` nullable
- `retrieved_source_count` nullable
- `empty_recall` nullable
- `citation_expected` nullable
- `citation_count` nullable
- `citation_missing` nullable
- `refusal_class` nullable
- `acl_decision` nullable
- `acl_anomaly_code` nullable
- `fail_closed` nullable
- `model_provider` nullable
- `model_name` nullable
- `input_tokens` nullable
- `output_tokens` nullable
- `cached_input_tokens` nullable
- `estimated_cost_microusd` nullable
- `trace_available`
- `projection_lag_ms` nullable
- `measured_at`
- `updated_at`

最小索引：

- `(started_at desc)`
- `(status, started_at desc)`
- `(surface, started_at desc)`
- `(selected_target, started_at desc)`
- `(principal_type, started_at desc)`
- `(model_name, started_at desc)`
- `(collection, started_at desc)`

规则：

- `request_id` 与 `runtime.request_execution.request_id` 一一对应
- `accepted` 阶段必须先 seed 这张表；`finalized` 阶段必须 upsert typed execution outcome
- `projection materialization` 负责更新 `projection_lag_ms`、`measured_at` 与 projection health summary，不回写 `runtime.request_execution`
- 这是 app-owned summary fact family，不保存 raw prompt、raw answer、raw transcript、raw retrieval payload、raw auth material
- token / model / cost 字段只能来自 execution-side typed telemetry seam，不从 panel 或 sink query 反推
- panel 和 aggregate APIs 只能读 app-owned projection/fact family，不得直连 `Sentry` / `Axiom` 原始 sink

## `operator.request_projection`

用途：

- panel `Requests` 的 canonical read model

最小列：

- `request_id`
- `trace_id`
- `surface`
- `conversation_id`
- `principal_type`
- `principal_id`
- `principal_label` nullable
- `entitlement_snapshot_id` nullable
- `entitlement_groups_json`
- `visibility_scope` nullable
- `applicability_scope` nullable
- `requested_capability` nullable
- `requested_scope_json` nullable
- `selected_target` nullable
- `status`
- `error_code` nullable
- `question_preview`
- `answer_preview` nullable
- `diagnostics_json` nullable
- `source_doc_ids_json`
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `projected_at`

最小索引：

- `(started_at desc)`
- `(status, started_at desc)`
- `(conversation_id, started_at desc)`

规则：

- `request_id` 与 `runtime.request_execution.request_id` 一一对应
- 这是 panel-facing materialized view，不要求与 command-side 列完全相同
- 不从 `chat.messages` 反推生成
- 这层允许展示 app-layer 已物化的最小授权摘要，但不承担 canonical authz store，也不回放 provider/session 原始材料
- `diagnostics_json` 只承载 panel 可直接消费的 summary-level explanation，不承载 retrieval internals

## Ownership Notes

### Chat Ownership

- `chat.conversations`
- `chat.messages`

只服务：

- public chat UX
- current-user history

不服务：

- operator request list/detail

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

只服务：

- panel list/detail
- pagination / filtering / detail view

不服务：

- replay execution
- chat history

## Migration Rules

- Better Auth 相关表与 app-domain 表共享同一条 Drizzle migration pipeline
- app-domain 第一波 migration 至少包含 `chat.*`、`runtime.*`、`operator.*`
- Worker runtime 使用 Hyperdrive；migration 命令不通过 Hyperdrive 执行
- migration / drift check / schema inspection 使用 direct database management connection
- 允许第一版单库共存，但禁止把 schema separation 退化成无边界的大表堆
