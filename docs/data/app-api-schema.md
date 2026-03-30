---
doc_type: data
status: active
created: 2026-03-28
updated: 2026-03-29
---

# App API Schema

## 文档边界

这份文档冻结 `apps/app-api` 的逻辑分域、最小表形态、主键与 ownership 规则。

它补充但不替代以下文档：

- `app-api` runtime 与边界：`docs/architecture/app-api-architecture.md`
- request projection ownership：`docs/architecture/request-projection-and-runtime-read-model.md`
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

固定逻辑分域：

- `auth.*`
- `chat.*`
- `runtime.*`
- `operator.*`

## Global Rules

- 所有业务主键使用 opaque text id；不要把自增整数暴露成长期 API 依赖
- `chat.*` 是 consumer UX truth，不是 operator request truth
- `operator.*` 是 panel read model，不是 chat history truth
- `runtime.*` 是 request command-side truth 与 projection input truth
- 第一版不单独建立 operator end-user 用户系统表

## Schema Code Ownership

`apps/app-api` 的数据库代码组织固定为：

- `auth.*`
- `chat.*`
- `runtime.*`
- `operator.*`

它们共享：

- 一套 Drizzle schema codebase
- 一条 migration pipeline
- 一份 schema 版本历史
- `drizzle.app_api_migrations` 这张专属 migration journal table

这意味着：

- Better Auth 不单独维护另一套仓库外 migration 世界观
- app-domain 也不应拆出第二条 migration pipeline
- 可以按模块分文件组织 schema，但不能把 migration 真相源拆裂

## `auth.*`

`auth.*` 由 Better Auth 拥有。

第一版至少存在以下逻辑表：

- `auth.users`
- `auth.sessions`
- `auth.accounts`
- `auth.verification`

规则：

- 具体物理表名允许由 Better Auth adapter 决定
- Better Auth adapter-owned 表与 app-domain 表继续共享同一条 migration pipeline
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
- `requested_scope_json` 与 `source_doc_ids_json` 使用结构化 JSON，不把 Python-side payload 原样塞进宽 JSON dump

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
- `requested_capability` nullable
- `requested_scope_json` nullable
- `selected_target` nullable
- `status`
- `error_code` nullable
- `error_message` nullable
- `question_preview`
- `answer_preview` nullable
- `source_doc_ids_json`
- `started_at`
- `completed_at` nullable
- `duration_ms` nullable
- `last_event_id`
- `projected_at`

最小索引：

- `(started_at desc)`
- `(status, started_at desc)`
- `(conversation_id, started_at desc)`

规则：

- `request_id` 与 `runtime.request_execution.request_id` 一一对应
- 这是 panel-facing materialized view，不要求与 command-side 列完全相同
- 不从 `chat.messages` 反推生成

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
