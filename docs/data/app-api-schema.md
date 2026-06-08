---
doc_type: data
status: active
created: 2026-03-28
updated: 2026-05-01
---
# App API Schema

## 文档边界

这份文档冻结 `apps/app-api` 的逻辑分域、最小表形态、主键与 ownership 规则。

它补充但不替代以下文档：

- `app-api` runtime
  与边界：`docs/architecture/system/product-runtime-architecture.md`
- request projection
  ownership：`docs/architecture/system/product-runtime-architecture.md`
- 产品层 HTTP contract：`docs/contracts/app-api-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- `official_web` control-plane schema：`docs/data/app-api-official-web-schema.md`
- identity platform logical schema：`docs/data/identity-platform-schema.md`
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

- `app_auth.*`
- `chat.*`
- `runtime.*`
- `operator.*`
- `official_web.*`
- `docs.*`
- `profile.*`

已冻结但尚未 materialized 的 forward product schema：

- future `identity.*` product schema, once implemented, is governed by
  `docs/data/identity-platform-schema.md`; current `app_auth.*` Better Auth
  runtime tables must not be treated as the product account model

补充说明：

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
- `chat.*`
- `runtime.*`
- `operator.*`
- `official_web.*`
- `docs.*`
- `profile.*`

`official_web` control-plane 落地时，可以在保持同一 migration pipeline 的前提下新增
`official_web.*`；具体规则另见 `docs/data/app-api-official-web-schema.md`。

它们共享：

- 一套 Drizzle schema codebase
- 一套 runtime type 定义与 query helpers

但 migration ownership 已显式拆分为：

- `apps/app-api` 的 `drizzle.app_api_migrations` 拥有 `runtime.*` / `operator.*` /
  `official_web.*` / `docs.*` / `profile.*`
- `apps/app-api` shared-product bootstrap 负责 `app_auth.*` / `chat.*` 的 bootstrap
  / adoption，不与 `drizzle.app_api_migrations` 混用同一 ownership 语义

这意味着：

- `apps/app-api` 运行时仍可通过统一 schema codebase 访问 `app_auth.*` / `chat.*`
- 但不能再把 `app_auth.*` / `chat.*` 误写成 `app-api` Drizzle migration ownership
- 可以按模块分文件组织 schema，但 bootstrap/adoption owner 与 Drizzle migration owner 都必须保持显式

## `app_auth.*`

`app_auth.*` 由 Better Auth 拥有。

Identity Platform product schemas are described separately in
`docs/data/identity-platform-schema.md`. The separation is intentional:
`app_auth.*` is runtime credential/session substrate, while product account,
campus identity, access, preferences and federation policy belong to app-owned
identity product schemas when materialized.

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

- 只承载 public chat user 的 conversation ownership
- conversation 可以通过显式 draft create 创建，也可以在首轮 `POST /api/chat/requests` 中 lazy
  create
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
- `request_id` 用于和 request observability / operator quality read model 关联
- operator quality feedback aggregates 以
  `runtime.request_observability_fact.started_at`
  所在窗口为准，通过 `request_id` 关联 `chat.message_feedback`；feedback `updated_at`
  只表示投票更新时间，不重新定义 operator quality 时间窗
- `vote=unhelpful` 可以作为 operator quality eval candidate export 输入；export 只携带
  `request_id`、`conversation_id`、`message_id`、reason code、typed intent summary
  与受控
  quality posture，不携带 raw transcript、raw auth material、provider raw response 或
  retrieval
  payload
- feedback 不参与 authorization、serving surface、tool permission、memory projection 或
  supervisor admission
- rollout / rollback 不改变表语义：关闭 public-chat-web UI 只停止新浏览器入口，不删除
  `chat.message_feedback`；已写入 feedback 继续作为 app-api-owned quality signal
  供 operator summary、timeseries 和 eval candidate export 读取

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
- 第一版只承载可回灌到 supervisor 的 typed confirmed slots；不承载 raw transcript、模型摘要或未确认草稿
- 当前已冻结的 curriculum slot contract：
  - `curriculum_program_family`
  - `curriculum_program`
  - `curriculum_semester`
- 这些 slot 只有在 `app-api` 从 finalized supervisor/rag diagnostics 中拿到 resolved
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
- 支撑 `public-docs` same-site `/api/docs/*` navigation / search / resolve seam

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
- 把 canonical `doc_id` / `document_slug` / current version 归一化为 browser-facing
  摘要

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

- Phase 2 首发只开放 `visibility_level=public`、`delivery_mode=public_static_asset` 且无
  entitlement groups 的 public current subset
- `gated_asset` 只能进入受控 delivery phase，不得误入匿名 `public-docs` static bundle

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

- `search_units` 不保存 `chunk_id`；docs search 返回的是 reader target，不是 retrieval
  trace
- snippet 来自 canonical reader units / blocks，不得把 raw chunk payload 直出到 browser
  contract

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
- 关闭 projection 不删除 memory item，但后续 supervisor input 必须投影为空
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
- `value` 只作为 personalization weak truth，不得写入 retrieval source truth 或 authz
  truth
- projection path 只读取当前 owner 的 enabled + user-visible items
- 删除 item 后，不得再进入后续 `ContextProjection.profile_memory.items`

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
- `principal_type`
- `principal_label` nullable
- `entitlement_snapshot_id` nullable
- `entitlement_groups_json`
- `visibility_scope` nullable
- `applicability_scope` nullable
- `idempotency_key` nullable
- `request_fingerprint_sha256` nullable
- `trace_id`
- `run_id` nullable
- `requested_capability` nullable
- `requested_scope_json` nullable
- `version_query_json` nullable
- `resolved_scope_json` nullable
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
- `(run_id, started_at desc)`
- unique `(actor_user_id, idempotency_key)` where `idempotency_key is not null`

`status` 第一版允许：

- `accepted`
- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`
- `cancelled`

规则：

- 这是 panel request truth 的上游 command-side owner
- 首轮 lazy-create 请求在分配 canonical conversation id 之前，允许用稳定的 new-conversation
  discriminator 参与 `request_fingerprint_sha256` 计算
- `question_preview` / `answer_preview` 是 projection-friendly 摘要，不要求保存 raw full
  prompt / raw full answer
- `principal_type` / `principal_label` 是 command-side 落盘后的最小 operator projection
  metadata；不要再把 raw auth/session snapshot 宽 JSON 写入这里
- `entitlement_snapshot_id` / `entitlement_groups_json` / `visibility_scope` /
  `applicability_scope` 只保存 app-layer 已收口的最小授权摘要，用于 request projection 与
  operator-facing restricted request diagnostics；不要把 raw provider claims、raw
  cookie、raw session 或宽 auth snapshot 落进这里
- `requested_scope_json` 与 `source_doc_ids_json` 使用结构化 JSON，不把 Python-side
  payload 原样塞进宽 JSON dump
- `requested_scope_json` 表示 accept 时上游显式请求的 scope，可为空
- `version_query_json` 保存 raw caller-supplied version query；缺失表示 caller 没有显式覆盖
  current
- `resolved_scope_json` 表示 finalized execution 实际命中的 serving scope；如果 agent
  自主解析 surface，这里必须落最终解析结果
- `selected_target` 表示 finalized execution 实际选择的 current runtime target；它不承载
  forward family vocabulary，也不应被重载为 operator-facing display label
- `run_id` 是 durable agent runtime 的 answer execution backlink；cutover 前旧同步执行
  路径可以为空，durable chat 主路径必须在第一次 command-side commit 后显式绑定真实
  durable `Run`
- `diagnostics_json` 只保存 operator-facing summary diagnostics，例如 resolved policy
  object、rewritten query、clarification/no-answer reason 与 retrieved title
  summary；不要写 raw evidence snippet、score 或 backend payload
- `rejected` 覆盖两类显式 fail-close：
  - supervisor policy reject
  - app-api precheck reject，例如 future `Phase I` throttle 命中后的
    `error_code=rate_limit_exceeded`
- 因此 `rate_limit_exceeded` 不新增新的 request status；它固定表现为 `status=rejected`
- `cancelled` 表示 execution 已接受 explicit cancel 或 upstream cancel 并停止等待；它不是
  semantic answer failure

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
- `request.approval_required`
- `request.rejected`
- `request.cancelled`
- `execution.admission_rejected`
- `execution.cancel_requested`
- `execution.cancelled`
- `execution.bridge_failed`
- `execution.timed_out`

规则：

- projector 必须按 `event_id` 做幂等消费
- outbox payload 只携带 projection 所需字段，不承担 raw audit dump 角色
- `execution.*` payload 只允许 Go `apps/execution-control` 的 safe runtime summary，例如
  lane、decision、failure kind、HTTP status、retryable、duration、queue wait、
  bridge duration；禁止 raw prompt、raw answer、raw transcript、auth material、
  retrieval payload 或 provider raw response

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
- `policy_reason` nullable
- `requested_capability` nullable
- `requested_scope_summary` nullable
- `version_query_mode` nullable
- `version_query_summary` nullable
- `resolved_scope_summary` nullable
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
- `retrieved_sources_json` not null default `[]`
- `supporting_sources_json` not null default `[]`
- `empty_recall` nullable
- `citation_expected` nullable
- `citation_count` nullable
- `citation_missing` nullable
- `refusal_class` nullable
- `semantic_outcome` nullable
- `scope_class` nullable
- `acl_decision` nullable
- `acl_anomaly_code` nullable
- `fail_closed` nullable
- `model_provider` nullable
- `model_name` nullable
- `prompt_id` nullable
- `prompt_version` nullable
- `template_sha256` nullable
- `prompt_runtime_state` nullable
- `prompt_runtime_detail` nullable
- `input_tokens` nullable
- `output_tokens` nullable
- `cached_input_tokens` nullable
- `estimated_cost_microusd` nullable
- `retrieval_adequacy_verdict` nullable
- `retrieval_adequacy_reason` nullable
- `claim_support_summary_json` nullable
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
- `accepted` 阶段的 `resolved_scope_summary` 与 `collection` 必须保持 `null`
- `finalized` 阶段的 `collection` 必须按 `resolved_scope_summary` 对应的最终 collection
  回填，不能继续拿 `requested_scope_summary` 充当真实执行 collection
- `selected_target` 继续只保存 current runtime target，供 operator projection /
  aggregate 过滤；future family grouping 如有需要，应走显式新字段或 projection
- `version_query_mode` / `version_query_summary` 只保存 operator-safe 版本查询摘要，不回放
  raw caller payload
- `retrieval_adequacy_verdict` / `retrieval_adequacy_reason` 表示 retrieval base
  是否足以支撑回答；它们与 `grounding` 结果不是同一维度
- `retrieved_sources_json` 保存 bounded raw retrieval candidate
  trace；`supporting_sources_json` 保存最终 answer-facing support trace
- 两列都只允许保存 operator-safe compact identity fields，不保存 raw snippet、raw provider
  citation blob 或 vendor payload
- `supporting_sources_json` 必须允许同时表达 canonical source identity 与 physical
  projection-unit identity，例如 `canonical_source_id` / `source_unit_key`
- `claim_support_summary_json` 只保存 operator-safe 聚合摘要，不保存 raw
  `claim_supports`、support snippet 或 provider-native citation/support blob
- `projection materialization` 负责更新 `projection_lag_ms`、`measured_at` 与
  projection health summary，不回写 `runtime.request_execution`
- 这是 app-owned summary fact family，不保存 raw prompt、raw answer、raw transcript、raw
  retrieval payload、raw auth material
- prompt 相关列只保存 observability-safe identity 与 typed runtime state，不保存 raw prompt
  或 provider refusal 文本
- token / model / cost 字段只能来自 execution-side typed telemetry seam，不从 panel 或
  sink query 反推
- panel 和 aggregate APIs 只能读 app-owned projection/fact family，不得直连 `Sentry` /
  `Axiom` 原始 sink

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
- `version_query_json` nullable
- `resolved_scope_json` nullable
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
- `requested_scope_json` 用于展示调用方显式约束；`resolved_scope_json` 用于展示 agent 最终解析的
  serving scope
- `version_query_json` 用于展示 raw caller-supplied version query；operator surface
  如需友好文案应改读 `runtime.request_observability_fact.version_query_summary`
- 不从 `chat.messages` 反推生成
- 这层允许展示 app-layer 已物化的最小授权摘要，但不承担 canonical authz store，也不回放 provider/session
  原始材料
- `diagnostics_json` 只承载 panel 可直接消费的 summary-level explanation，不承载 retrieval
  internals

## `operator.request_audit_projection`

用途：

- panel `Audit` 域的 curated request-scoped timeline
- request observability detail 的 `auditSummary` 上游

最小列：

- `audit_event_id`
- `request_id`
- `trace_id`
- `occurred_at`
- `event_type`
- `surface`
- `principal_type`
- `entitlement_snapshot_id` nullable
- `policy_projection_version` nullable
- `requested_capability` nullable
- `selected_target` nullable
- `status`
- `terminal_code` nullable
- `summary`
- `diagnostics_json`
- `projected_at`

最小索引：

- `(request_id, occurred_at desc)`
- `(trace_id, occurred_at desc)`
- `(event_type, occurred_at desc)`
- `(status, occurred_at desc)`

规则：

- `audit_event_id` 默认与 `runtime.projection_outbox.event_id` 对齐，保证幂等 timeline 物化
- 这是 curated governance-safe audit projection，不是 raw JSONL replay
- `status` 表示该 audit event 自身的阶段语义；`terminal_code` 表示当前请求最终 terminal
  outcome，二者不得混写
- `diagnostics_json` 只保存受控最小摘要，例如
  `fail_closed`、`acl_anomaly_code`、`source_doc_ids`；当 event type 为
  `execution.*` 时，可以额外保存 lane、decision、failure kind、HTTP status、
  retryable、duration、queue wait 与 bridge duration
- 不保存 raw JWT、raw cookie、raw prompt、raw answer、raw retrieval payload 或 vendor
  sink blob

## `operator.authenticated_notice_processing_projection`

用途：

- protected panel `通知处理` 的 canonical read model
- authenticated notice queue / downstream materialization 的 operator-safe status
  projection

最小列：

- `processing_id`
- `notice_key`
- `source_channel`
- `source_surface`
- `site_id`
- `notice_id`
- `title`
- `run_id` nullable
- `job_id` nullable
- `replay_batch_id` nullable
- `enqueue_source` nullable
- `queue_status`
- `lifecycle_status`
- `latest_stage`
- `target_surface` nullable
- `candidate_kind` nullable
- `materialization_status` nullable
- `release_id` nullable
- `current`
- `tool_ready`
- `read_model_counts_json`
- `child_task_summary_json`
- `timeline_json`
- `downstream_json` nullable
- `last_error_code` nullable
- `last_error_message` nullable
- `attempt_count`
- `last_observed_at`
- `source_updated_at` nullable
- `projected_at`
- `producer_version`
- `redaction_version`

最小索引：

- `(notice_id, projected_at)`
- `(notice_key, projected_at)`
- `(lifecycle_status, projected_at)`
- `(target_surface, candidate_kind, projected_at)`
- `(run_id, projected_at)`

规则：

- `processing_id` 是 snapshot 幂等键，不是 queue row 的替代主键
- 这张表只服务 app-api operator list/detail；不改变 source-truth、queue、release 或
  downstream read-model truth
- detail effective record 排序固定优先 `tool_ready=true`、`current=true`、
  `projected_at desc`
- `read_model_counts_json` 只能保存 operator-safe aggregate counts，例如
  `scheduledDepartures`、`rejectedSources`、`snapshots` 与 `currentSnapshots`
- `timeline_json` 与 `downstream_json` 只能保存 sanitized summaries；不得保存 raw
  notice body、HTML、OCR text/table、attachment bytes、object-store key、local path、
  credential 或 raw stack trace
- `timeline_json.payload` 允许保存 compact operator evidence，例如
  `reasonCode`、`regulationAdmissionClass`、`promotionDisposition`、
  `applicabilityStatus`、`targetCollection`、`auditRunId`、`cleanupRunId`、
  `cleanupDisposition`、`postgresExactRemaining`、
  `objectStoreExactKeysRemaining` 与 `qdrantResidueCount`
- `timeline_json.payload` 禁止保存 bucket、object key、backup path、artifact path、raw
  operations path 或任何可反向定位 source/derived object 的字段
- first release 是 read-only projection；retry、cancel、re-enqueue 不是这张表或 panel
  surface 的职责

## `operator.authenticated_notice_processing_event_projection`

用途：

- authenticated notice processing detail timeline 的 idempotent event projection
- 后续 freshness / reconciliation diagnostics 的 operator-safe event source

最小列：

- `event_id`
- `processing_id`
- `notice_key`
- `notice_id`
- `run_id` nullable
- `job_id` nullable
- `stage`
- `status`
- `occurred_at`
- `summary`
- `payload_json`
- `projected_at`

最小索引：

- `(processing_id, occurred_at)`
- `(notice_id, occurred_at)`

规则：

- `event_id` 可由 upstream event id 传入；缺省时由 snapshot identity、stage、status、
  occurred time 与 ordinal 派生
- `payload_json` 只允许 compact reason code、count、typed status 或 audit/cleanup run
  id，不允许 raw logs、source file path、object-store locator、backup path 或
  OCR/provider payload
- event projection 只解释 operator timeline，不作为 ingestion retry / cancellation
  command source

## `operator.authenticated_notice_run_processing_projection`

用途：

- protected panel `通知 run 处理` 的 canonical read model
- authenticated notice collector run / replay batch / queue run 的 operator-safe
  status projection

最小列：

- `run_processing_id`
- `run_key`
- `source_channel`
- `source_surface`
- `site_id`
- `collector_run_token`
- `run_id`
- `replay_batch_id` nullable
- `enqueue_source` nullable
- `lifecycle_status`
- `latest_stage`
- `latest_queue_status`
- `queue_job_count`
- `queue_status_counts_json`
- `attempt_count`
- `source_truth_json`
- `child_task_summary_json`
- `downstream_json`
- `job_summaries_json`
- `timeline_json`
- `last_error_code` nullable
- `last_error_message` nullable
- `first_observed_at`
- `last_observed_at`
- `projected_at`
- `producer_version`
- `redaction_version`

最小索引：

- `(collector_run_token, projected_at)`
- `(run_id, projected_at)`
- `(site_id, lifecycle_status, projected_at)`
- `(latest_queue_status, projected_at)`

规则：

- `run_processing_id` 是 run snapshot 幂等键，不是 queue row 的替代主键
- 这张表只服务 app-api operator list/detail；不改变 source-truth、queue、release 或
  downstream read-model truth
- run-level projection 只回答 collector run / replay batch / queue run 的整体状态，不承载
  单个 notice 的 effective processing 详情
- `source_truth_json` 可保存 `selectedNoticeCount`、`importedNoticeCount`、
  `attachmentFetchStatusRecordCount`、`rawUploadedCount`、`rawReusedCount` 与少量
  title/id
  samples；不得保存 raw source object refs
- `downstream_json` 可保存 candidate kind、target surface、materialized release
  count 与 status summary；source-truth-only run 可显示 `skipped_source_truth_only`
- `job_summaries_json` 只保存 job id、run id、queue status、attempt
  count、selected/imported
  count、updated timestamp 与 normalized error 信息
- first release 是 read-only projection；retry、cancel、re-enqueue 不是这张表或 panel
  surface 的职责

## `operator.authenticated_notice_run_processing_event_projection`

用途：

- authenticated notice run-processing detail timeline 的 idempotent event
  projection
- 后续 run-level freshness / reconciliation diagnostics 的 operator-safe event
  source

最小列：

- `event_id`
- `run_processing_id`
- `run_key`
- `collector_run_token`
- `run_id`
- `job_id` nullable
- `stage`
- `status`
- `occurred_at`
- `summary`
- `payload_json`
- `projected_at`

最小索引：

- `(run_processing_id, occurred_at)`
- `(collector_run_token, occurred_at)`

规则：

- `event_id` 可由 upstream event id 传入；缺省时由 run snapshot identity、stage、status、
  occurred time 与 ordinal 派生
- `payload_json` 只允许 compact reason code、count 与 typed status，不允许 raw logs、
  source file path、object-store locator、backup path、OCR/provider payload 或 raw
  stack
- event projection 只解释 run-level operator timeline，不作为 ingestion retry /
  cancellation command source

## `operator.metric_rollup`

用途：

- operator aggregate / timeseries read-model family
- 当前第一版支撑 `Overview` / `Quality` / `Safety` / `Cost` 中可由 app-owned rollup 提供的聚合面
- 当前已冻结的第一版 schema 已先落地 `Quality` timeseries bucket

最小列：

- `rollup_id`
- `request_id`
- `domain`
- `granularity`
- `bucket_start`
- `bucket_end`
- `surface`
- `selected_target` nullable
- `requested_capability` nullable
- `principal_type`
- `collection` nullable
- `model_name` nullable
- `metrics_json`
- `projected_at`

最小索引：

- `(domain, granularity, bucket_start)`
- `(request_id, granularity, bucket_start)`
- `(domain, surface, bucket_start)`
- `(domain, selected_target, bucket_start)`

规则：

- 这是 app-owned aggregate contribution family，不是不可逆 counter table
- projector 采用“每 request / 每 bucket / 每 granularity 一条可重算贡献行”的物化语义，允许按
  `request_id` 全量替换后重放
- `rollup_id` 必须包含 `request_id` 与 bucket/filter 维度，避免不同 request 落在同一 bucket
  时发生主键冲突
- 当前已冻结的第一版 schema 仅冻结 `domain=quality` 的 rollup shape
- `metrics_json` 只保存受控聚合贡献，不保存 raw request payload、raw sink blob 或 grader 原始结果
- 当前 feedback quality summary / timeseries 直接由 app-api query service 用
  `chat.message_feedback.request_id` join
  `runtime.request_observability_fact.request_id`
  得到；它不是 raw sink query，也暂不写入 `operator.metric_rollup.metrics_json`

## `operator.quality_badcase_projection`

用途：

- operator `Quality` 域的 app-owned badcase queue
- 当前已冻结的第一版 schema 支撑 `GET /api/operator/quality/badcases`

最小列：

- `badcase_id`
- `request_id`
- `trace_id`
- `surface`
- `selected_target` nullable
- `status`
- `cause_class`
- `detected_by`
- `opened_at`
- `summary`
- `grade_json` nullable
- `projected_at`

最小索引：

- `(status, opened_at desc)`
- `(cause_class, opened_at desc)`
- `(detected_by, opened_at desc)`
- `(request_id, opened_at desc)`

规则：

- 这是 app-owned curated queue，不是 grader 原始输出表，也不是 sink issue 列表
- 当前已冻结的第一版 schema 仅由 runtime monitor 生成 badcase，`detected_by` 固定为
  `runtime_monitor`
- 当前已冻结的第一版 schema 已开放以下 app-owned runtime monitor
  `cause_class`：
  `citation_missing`、`empty_recall`、`grounding_failed`、
  `unsupported_by_evidence`、`policy_failed`、`authz_suspected` 与
  `freshness_fail_close`
- `badcase_id` 采用 request-scoped stable id，保证 projector 重放时幂等替换
- `grade_json` 为 sampled grading / 人工复核的后续回流保留；当前已冻结的第一版 schema 允许为 `null`
- `summary` 必须是 panel-safe 安全摘要，不得回放 raw prompt、raw answer、raw retrieval payload
- `GET /api/operator/quality/eval-candidates` 不新增独立表；它从
  `operator.quality_badcase_projection`、`operator.quality_grade_projection` 与
  `operator.trace_backlink_projection` 派生 operator-safe eval candidate intake，
  不写入 eval golden truth

## `operator.quality_grade_projection`

用途：

- operator `Quality` 域的 sampled grade read model
- `quality summary.sampledGrades`、`quality timeseries.sampledGroundingPassRate`
  与 `quality badcases.grade` 的 app-owned 上游

最小列：

- `grade_id`
- `request_id`
- `trace_id`
- `surface`
- `request_started_at`
- `selected_target` nullable
- `requested_capability` nullable
- `principal_type`
- `collection` nullable
- `model_name` nullable
- `grade_source`
- `grade_domain`
- `verdict`
- `score_milli` nullable
- `grader_version`
- `rationale_summary` nullable
- `sampled_at`
- `projected_at`

最小索引：

- `(request_id, grade_domain)`
- `(grade_domain, request_started_at desc)`
- `(grade_domain, surface, request_started_at desc)`
- `(grade_source, sampled_at desc)`

规则：

- 这是 app-owned projection，不是 grader sink query cache
- `grade_id` 必须稳定地绑定 `request_id + grade_source + grade_domain`，保证重复回流时 upsert
  幂等
- `request_started_at` 保留 request window 对齐语义；aggregate query 不按 grader 到达时间反向定义
  request bucket
- 第一版 `grade_domain` 固定至少覆盖 `grounding`、`citation`、`policy`
- 第一版 `verdict` 固定至少允许 `pass`、`fail`、`needs_review`
- `score_milli` 只保存 panel 可展示的轻量分值；不保存 grader 原始 token-by-token 判断材料

## `operator.trace_backlink_projection`

用途：

- operator-facing request trace / issue deep link projection
- request observability detail、audit detail、quality badcase queue 的 `links.*` 上游

最小列：

- `request_id`
- `trace_id`
- `trace_link` nullable
- `issue_link` nullable
- `issue_fingerprint` nullable
- `projected_at`

最小索引：

- `(trace_id)`
- `(projected_at desc)`

规则：

- 这是 app-owned backlink projection，不是 raw sink event cache
- `request_id` 与 request-facing operator surfaces 一一对应
- deep link / fingerprint 可以来自 sink reconciliation 或 trace system，但必须先写入这里，panel
  不得直连 sink
- 不允许保存 raw trace payload、raw issue body、raw vendor event blob

## Ownership Notes

### Chat Ownership

- `chat.conversations`
- `chat.messages`
- `chat.message_feedback`

只服务：

- public chat UX
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
