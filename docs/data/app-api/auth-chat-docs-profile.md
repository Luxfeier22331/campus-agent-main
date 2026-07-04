---
doc_type: data
truth_scope: data
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Auth Chat Docs Profile Schema

<!-- markdownlint-disable MD013 -->

## Document Boundary

This document owns app-api logical data shape for auth, chat, docs reader and
profile-memory projection tables. It does not own Better Auth adapter internals,
browser UX, execution runtime contracts or runbook procedures.

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
- `app-api` runtime 与 shared-product bootstrap 使用 `app_auth.*`，但当前不由 `app-api`
  Drizzle journal 直接接管
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

- 只承载 online answer user 的 conversation ownership
- conversation 可以通过显式 draft create 创建，也可以在首轮
  `POST /api/chat/requests/stream` 中 lazy create
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
- `structured_parts_json` nullable

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
- `structured_parts_json` 用于持久化 typed assistant structured parts；repo 当前已预留
  `place_card` 形态，但由于校内导航在地图实际上线前暂不支持，当前产品路径不会写入该类型
- `structured_parts_json` 由 `app-api` 负责把 execution-side `snake_case` payload
  归一化成 browser-facing `camelCase` shape；它不保存 provider response blob 或
  provider-specific IDs
- 当前 `role=user` message 仍写空 structured parts；首发 structured payload 只来自
  assistant finalized turn

## `chat.message_feedback`

用途：

- 当前用户对单条 assistant answer 的 latest quality feedback

最小列：

- `feedback_id`
- `owner_user_id`
- `conversation_id`
- `message_id`
- `request_id`
- `vote`
- `reason_codes_json`
- `created_at`
- `updated_at`

最小索引：

- unique `(owner_user_id, message_id)`
- `(request_id)`
- `(updated_at desc)`

`vote` 第一版允许：

- `helpful`
- `unhelpful`

`reason_codes_json` 第一版允许：

- `wrong_intent`
- `not_enough_detail`
- `outdated_or_missing_source`
- `incorrect_answer`
- `unclear_or_hard_to_use`
- `other`

规则：

- target 必须是当前 owner conversation 内的 assistant message
- target message 必须有 non-null `request_id`
- assistant `kind=error` 不接受 feedback
- `reason_codes_json` 只允许和 `vote=unhelpful` 一起出现，最多 3 个，且不能重复
- v1 不保存自由文本 comment
- `DELETE` 撤回反馈时 hard delete；不保留 tombstone
- 不保存 raw prompt、raw answer、provider response、retrieval payload 或 auth material
- `request_id` 用于和请求执行事实关联，帮助定位对应 `requestId` / `traceId`
- `chat.message_feedback` 是产品侧反馈事实，不是在线 Operator Console 的
  quality dashboard、eval candidate queue 或 release-closeout panel 输入
- `vote=unhelpful` 只能作为后续人工分析或 Langfuse / eval 平台导入的受控来源；导入能力
  必须另有显式 contract，不能从这张表隐式打开
- feedback 不参与 authorization、serving surface、tool permission、memory projection 或
  execution admission
- rollout / rollback 不改变表语义：关闭 campus-web UI 只停止新浏览器入口，不删除
  `chat.message_feedback`

## `chat.session_slots`

用途：

- conversation-scoped session truth
- 当前会话可确认的 typed follow-up slots

最小列：

- `conversation_id`
- `name`
- `value`
- `confirmed`
- `updated_at`

主键：

- `(conversation_id, name)`

最小索引：

- `(conversation_id, name)`

规则：

- 它属于 `chat.*` 的当前会话状态，不属于 `runtime.request_execution`
- 第一版只承载可回灌到 execution request context 的 typed confirmed slots；不承载 raw transcript、模型摘要或未确认草稿
- 当前已冻结的 curriculum slot contract：
  - `curriculum_program_family`
  - `curriculum_program`
  - `curriculum_semester`
- 这些 slot 只有在 `app-api` 从 finalized execution/rag diagnostics 中拿到 resolved
  curriculum follow-up truth 时才写入
- `needs_clarification`、generic alias conflict、soft preference 或无 typed
  follow-up truth 的请求不得写入这些 slot
- finalize 时按 `(conversation_id, name)` 维护当前 confirmed slot 快照：当前 turn 会先清空该
  conversation 既有 slot，再写入本次推导出的最新集合，而不是追加历史 slot
- 因此同一 conversation 的后续 curriculum completed turn 可以显式替换旧 semester / program
  truth，避免过期 follow-up 状态继续回灌
- `chat` API response 不把 `session_slots` 作为 C 端公开 contract 暴露；它是 app-layer
  session projection

## `docs.collections`

用途：

- document reader control-plane 的 collection read model
- 支撑 `campus-web /docs/*` same-origin `/api/docs/*` navigation / search /
  resolve seam

最小列：

- `corpus`
- `collection`
- `display_name`
- `description`
- `updated_at`

主键：

- `(corpus, collection)`

规则：

- `docs.*` 是 app-api runtime read model，不是 canonical document artifact truth
- object storage 仍是 reader asset bytes 的 publish truth
- browser-facing response 不得暴露 object store key、raw provider path、raw source
  locator 或 chunk id

## `docs.documents`

用途：

- public/current document identity read model
- 把 canonical `doc_id` / `document_slug` / current version 归一化为 browser-facing 摘要

最小列：

- `doc_id`
- `corpus`
- `collection`
- `document_slug`
- `title`
- `canonical_url`
- `current_version_id`
- `current_version_slug`
- `updated_at`

最小索引：

- unique `(corpus, collection, document_slug)`
- `(corpus, collection, title)`

## `docs.document_versions`

用途：

- reader 可见 version / visibility / delivery-mode read model

最小列：

- `version_id`
- `doc_id`
- `version_slug`
- `label`
- `effective_from`
- `is_current`
- `visibility_level`
- `entitlement_groups_json`
- `delivery_mode`
- `updated_at`

最小索引：

- `(doc_id, is_current)`
- unique `(doc_id, version_slug)`
- `(delivery_mode, visibility_level, is_current)`

规则：

- 当前匿名 docs reader 只开放 `visibility_level=public`、
  `delivery_mode=public_static_asset` 且无 entitlement groups 的 public current
  subset
- `gated_asset` 只能进入受控 delivery path，不得误入匿名 docs static bundle

## `docs.reader_assets`

用途：

- reader asset descriptor read model
- 连接 `app-api` resolve response 与 deploy 后 `/_docs/...` static asset path

最小列：

- `version_id`
- `static_prefix`
- `content_url`
- `outline_url`
- `manifest_url`
- `source_objects_json`
- `target_objects_json`
- `updated_at`

规则：

- `source_objects_json` 可以保存对象存储 key 供 deploy/control-plane 内部使用
- browser-facing resolve response 只能返回 `content_url` / `outline_url` /
  delivery mode，不返回 `source_objects_json`
- `target_objects_json` 必须是 Worker static asset 相对路径，不是外部 URL

## `docs.search_units`

用途：

- source-card compatible docs search read model
- 只保存 reader target 需要的 section hit 信息

最小列：

- `search_unit_id`
- `doc_id`
- `version_id`
- `title`
- `anchor`
- `canonical_url`
- `highlight_root_unit_ids_json`
- `snippet`
- `search_text`
- `unit_order`

最小索引：

- `(doc_id, version_id, unit_order)`
- `(version_id, search_text)`

规则：

- `search_units` 不保存 `chunk_id`；docs search 返回的是 reader target，不是 retrieval trace
- snippet 来自 canonical reader units / blocks，不得把 raw chunk payload 直出到 browser contract

## `profile.memory_settings`

用途：

- user-owned profile memory projection setting
- 控制 profile memory 是否进入 execution `ContextProjection`

最小列：

- `owner_user_id`
- `profile_memory_enabled`
- `updated_at`

主键：

- `owner_user_id`

规则：

- 缺省 setting 等价于 `profile_memory_enabled=true`
- 关闭 projection 不删除 memory item，但后续 execution input 必须投影为空
- setting 只影响 personalization input，不影响 authz / serving surface / approval truth

## `profile.memory_items`

用途：

- user-owned long-term profile memory truth
- 当前仅承载用户显式声明的 user-visible personalization items

最小列：

- `item_id`
- `owner_user_id`
- `key`
- `value`
- `source_type`
- `confidence`
- `visibility`
- `created_at`
- `updated_at`
- `last_verified_at`

最小索引：

- unique `(owner_user_id, key)`
- `(owner_user_id, updated_at)`

规则：

- `source_type=user_declared` / `confidence=low` / `visibility=user_visible` 是当前
  browser-facing control surface 的默认写入姿态
- `key` 必须是安全 typed key，不能表达 authorization / permission / ACL / visibility
  语义
- `value` 只作为 personalization weak truth，不得写入 retrieval source truth 或 authz truth
- projection path 只读取当前 owner 的 enabled + user-visible items
- 删除 item 后，不得再进入后续 `ContextProjection.profile_memory.items`
