---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-03-28
updated: 2026-06-13
---

# App API HTTP Contract

<!-- markdownlint-disable MD013 -->

## Document Boundary

This file is the stable index for browser-facing app-api HTTP contracts.
It owns exposure classes, cross-cutting rules, shared response shapes and
endpoint grouping. Detailed endpoint bodies live in split contract docs.

## Split Documents

- `app-api-http/system-auth-profile-memory.md`
  - System, auth and profile memory: health, auth, me and memory endpoints
- `app-api-http/chat.md`
  - Chat: conversation, request, stream and event endpoints
- `app-api-http/operator.md`
  - Operator: operator request list and detail endpoints

## Index-Owned Baseline

## 文档边界

这份文档冻结 shared `apps/app-api` 对 `public-chat-web` 与 `protected-panel-web` 暴露的
browser-facing HTTP contract。

它补充但不替代以下文档：

- shared product topology：`docs/architecture/system/product-runtime-architecture.md`
- `app-api` runtime 与内部边界：`docs/architecture/system/product-runtime-architecture.md`
- `app-api -> execution-control`
  内部执行契约：`docs/contracts/capability-execution.md`
- internal eval benchmark
  ingress：`docs/contracts/app-api-eval-benchmark-http.md`
- operator observability query
  contract：`docs/contracts/app-api-operator-observability-http.md`
- `official_web` collector/control-plane HTTP
  contract：`docs/contracts/app-api-official-web-http.md`
- request lifecycle：`docs/contracts/app-api-request-lifecycle.md`
- error model：`docs/contracts/app-api-error-model.md`
- 数据模型：`docs/data/app-api-schema.md`

这份文档不冻结：

- browser 直接可见的 hostname、route mounting 方式或 Worker BFF 实现
- Better Auth 的 provider 细节
- panel UI layout
- token streaming 或异步后台回答产品形态
- `official_web` collector command endpoints

## 适用范围

这里的 API 是 `app-api` 的 browser-facing app contract。

长期调用形态固定为：

- `browser -> public-chat-web same-site /api/* -> app-api`
- `browser -> protected-panel-web same-site /api/* -> app-api`

因此：

- browser 默认不直连 `app-api` public hostname
- web surface 可以做 route proxy / BFF
- 但 proxy 后的 contract 必须保持与这里一致
- Worker web surfaces 必须通过 `APP_API` Service Binding 调用 `app-api`；其中
  `https://app-api.internal` 只是内部 Request URL origin
- `api-staging.mucwiki-edge.link` 如存在，只能作为 staging machine / ops ingress，
  不是本文 browser-facing app contract
- `official_web` collector command surface 与 app-owned run APIs 不属于本文范围，另见
  `docs/contracts/app-api-official-web-http.md`

## Route Exposure Classes

`apps/app-api/src/app/route-exposure.ts` 是当前 route exposure inventory 的代码侧
contract test carrier。新增 route 必须声明：

- `browser-surface`：由 public chat / docs same-site proxy 调用
- `operator-via-panel`：由 protected panel internal bridge 调用
- `machine-internal`：由 execution-control / eval / ingestion 等 trusted machine
  caller 调用
- `collector-machine`：由 official-web collector command caller 调用
- `system`：health / readiness probe

## Cross-Cutting Rules

- JSON body 使用 `camelCase`
- enum / code value 使用小写语义值，例如 `completed`、`no_answer`、`validation_failed`
- `POST /api/chat/requests` 与 `POST /api/chat/requests/stream` 支持
  `Idempotency-Key` header
- `requestId` 是业务级 correlation id；`traceId` 是 runtime trace correlation id
- `POST /api/chat/requests` 成功时返回 `x-request-id` 与 `x-trace-id`
- 所有错误响应使用 `docs/contracts/app-api-error-model.md` 中定义的统一 envelope

## Endpoint Summary

### System

- `GET /healthz`
- `GET /readyz`

### Auth

- `ALL /api/auth/*`
- `GET /api/me`

### Profile Memory

- `GET /api/me/profile-memory`
- `POST /api/me/profile-memory/items`
- `PATCH /api/me/profile-memory/settings`
- `DELETE /api/me/profile-memory/items/:itemId`

### Chat

- `GET /api/chat/conversations`
- `POST /api/chat/conversations`
- `GET /api/chat/conversations/:conversationId`
- `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- `DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing`
- `POST /api/chat/requests`
- `POST /api/chat/requests/stream`

### Operator

- `GET /api/operator/overview`
- `GET /api/operator/quality/summary`
- `GET /api/operator/safety/summary`
- `GET /api/operator/cost/summary`
- `GET /api/operator/audit`
- `GET /api/operator/audit/:auditEventId`
- `GET /api/operator/requests`
- `GET /api/operator/requests/:requestId`
- `GET /api/operator/requests/:requestId/observability`

expanded observability / quality / safety / cost / audit query surfaces 另见
`docs/contracts/app-api-operator-observability-http.md`

第一版不冻结：

- operator 写操作 API
- chat delete / archive API
- token streaming chat API
- `official_web` collector command endpoints

## Response Shapes

### Conversation Summary

```json
{
  "id": "conv_01HQ...",
  "title": "图书馆开放时间",
  "createdAt": "2026-03-28T07:10:00.000Z",
  "updatedAt": "2026-03-28T07:11:00.000Z"
}
```

### Chat Message

```json
{
  "id": "msg_01HQ...",
  "conversationId": "conv_01HQ...",
  "role": "assistant",
  "kind": "answer",
  "text": "图书馆开放到 22:00。",
  "createdAt": "2026-03-28T07:11:00.000Z",
  "feedback": null,
  "requestId": "req_01HQ..."
}
```

`kind` 允许以下值：

- `answer`
- `clarification`
- `no_answer`
- `error`

assistant message 可以包含 `feedback`：

```json
{
  "feedbackId": "fb_01HQ...",
  "messageId": "msg_01HQ...",
  "vote": "unhelpful",
  "reasonCodes": ["wrong_intent"],
  "createdAt": "2026-04-29T08:00:00.000Z",
  "updatedAt": "2026-04-29T08:00:00.000Z"
}
```

规则：

- `feedback` 只表示当前登录用户对该 assistant message 的 latest answer-quality feedback
- user message 不返回 feedback state
- assistant message 未反馈时返回 `feedback: null`
- `feedback` 不影响权限、routing、memory、serving surface 或 execution admission

### Conversation Detail

```json
{
  "id": "conv_01HQ...",
  "title": "图书馆开放时间",
  "createdAt": "2026-03-28T07:10:00.000Z",
  "updatedAt": "2026-03-28T07:11:00.000Z",
  "messages": []
}
```

### Profile Memory Item

```json
{
  "itemId": "mem_01HQ...",
  "key": "recent_goal",
  "value": "准备保研材料",
  "sourceType": "user_declared",
  "confidence": "low",
  "visibility": "user_visible",
  "lastVerifiedAt": "2026-04-27T00:00:00.000Z",
  "updatedAt": "2026-04-27T00:00:00.000Z"
}
```

规则：

- `profile memory` 是 app-owned personalization truth，不是 authorization truth
- browser-facing control surface 只允许当前 signed-in principal 管理自己的 user-visible memory
- `key` 必须是安全的 typed key，不接受 authorization / permission / ACL 类 key
- `value` 是用户声明的短文本偏好或目标，不能作为 ACL、serving surface 或 approval 权限来源
- profile memory API 是 product/manual management surface；online chat hot path 不再由
  `app-api` 读取 PG memory rows 并全量注入 `ContextProjection.profile_memory.items`
- 开启 profile memory 后，manual write path 必须同步到 execution-control / Qdrant
  `personal_memory_v1` index，后续 online recall 由 `context.memory_recall` activity
  按 top-k / char budget 选择 bounded memory context
- 关闭 memory projection 后，后续 `memory.recall` 不得返回该用户的 active personal
  memory item；legacy `ContextProjection.profile_memory.items` 如仍存在于 DTO，只能为空或被
  execution side 忽略

### Request Projection Summary

```json
{
  "requestId": "req_01HQ...",
  "traceId": "trace_01HQ...",
  "surface": "public_chat_web",
  "conversationId": "conv_01HQ...",
  "status": "completed",
  "requestedCapability": "knowledge",
  "requestedScope": {
    "corpus": "regulations",
    "collection": "student_rules"
  },
  "versionQuery": {
    "mode": "historical",
    "versionId": "v2024-student-rules"
  },
  "resolvedScope": {
    "corpus": "regulations",
    "collection": "student_rules"
  },
  "selectedCapability": "knowledge",
  "questionPreview": "图书馆开放到几点？",
  "answerPreview": "图书馆开放到 22:00。",
  "errorCode": null,
  "sourceDocIds": ["handbook:library-hours"],
  "startedAt": "2026-03-28T07:10:30.000Z",
  "completedAt": "2026-03-28T07:10:31.000Z",
  "durationMs": 842,
  "projectedAt": "2026-03-28T07:10:31.500Z"
}
```

补充约束：

- `selectedCapability` 始终表示 request finalized 后的 capability id。
- 它当前只承载 raw contract truth，不承载 forward family label，也不承载 operator-facing
  localized wording。
- 如果 browser 或 panel 需要展示友好名称，必须由 app-owned mapping / presentation layer
  派生，而不是重载这个字段。

## Explicit Non-Goals

- 不把已退役 standalone chat app 的旧 `/api/answer` 继续提升为 forward contract
- 不为 panel 暴露 database/admin-console 风格 API
- 不让 operator endpoints 旁路读取 `runtime.request_execution`
- 不把 `packages/contracts` 直接当 browser product API
