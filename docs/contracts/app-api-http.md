---
doc_type: contract
status: active
created: 2026-03-28
updated: 2026-04-23
---
# App API HTTP Contract

## 文档边界

这份文档冻结 shared `apps/app-api` 对 `public-chat-web` 与 `protected-panel-web` 暴露的
browser-facing HTTP contract。

它补充但不替代以下文档：

- shared product topology：`docs/architecture/system/product-runtime-architecture.md`
- `app-api` runtime 与内部边界：`docs/architecture/system/product-runtime-architecture.md`
- `app-api -> supervisor-api`
  内部执行契约：`docs/contracts/app-api-supervisor-execution.md`
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
- streaming 或异步回答产品形态
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
- `official_web` collector command surface 与 app-owned run APIs 不属于本文范围，另见
  `docs/contracts/app-api-official-web-http.md`

## Cross-Cutting Rules

- JSON body 使用 `camelCase`
- enum / code value 使用小写语义值，例如 `completed`、`no_answer`、`validation_failed`
- `POST /api/chat/requests` 支持 `Idempotency-Key` header
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

### Chat

- `GET /api/chat/conversations`
- `POST /api/chat/conversations`
- `GET /api/chat/conversations/:conversationId`
- `DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing`
- `POST /api/chat/requests`

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
- streaming chat API
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
  "requestId": "req_01HQ..."
}
```

`kind` 允许以下值：

- `answer`
- `clarification`
- `no_answer`
- `error`

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
  "selectedTarget": "rag-agent",
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

- `selectedTarget` 始终表示 request finalized 后的 current runtime target。
- 它当前只承载 raw contract truth，不承载 forward family label，也不承载 operator-facing
  localized wording。
- 如果 browser 或 panel 需要展示友好名称，必须由 app-owned mapping / presentation layer
  派生，而不是重载这个字段。

## System Endpoints

### `GET /healthz`

返回最小 liveness 信息。

```json
{
  "status": "ok",
  "app": "app-api"
}
```

### `GET /readyz`

返回 runtime dependency readiness 信息。

```json
{
  "status": "ready",
  "dependencies": {
    "auth": "ready",
    "database": "ready",
    "officialWebHandoff": "not_configured",
    "operatorBridge": "configured",
    "publicChatOrigin": "configured",
    "supervisorApi": "ready"
  }
}
```

当 runtime config 缺失时，返回 `503 dependency_not_ready`，并在 `details.missing` 中列出缺失键。

当 config 已齐但实际依赖未 ready 时，返回 `503 dependency_not_ready`，并在 `details.failed`
中列出失败 probe，例如：

```json
{
  "error": {
    "code": "dependency_not_ready",
    "message": "Runtime dependencies are not ready.",
    "retryable": true,
    "details": {
      "failed": {
        "auth": "better-auth session runtime failed probe",
        "supervisorApi": "supervisor /readyz returned 503"
      }
    }
  }
}
```

## Auth Endpoints

### `ALL /api/auth/*`

- 由 Better Auth handler 挂载
- `public-chat-web` 通过 same-site route 暴露给浏览器
- `protected-panel-web` 不在 v1 上复用这一套 end-user 登录流程

### `GET /api/me`

返回当前 app principal。

```json
{
  "principal": {
    "type": "campus_member",
    "principalId": "user_01HQ...",
    "displayName": "Jane Doe",
    "email": "jane@example.edu"
  },
  "session": {
    "sessionId": "sess_01HQ...",
    "expiresAt": "2026-03-29T07:00:00.000Z"
  },
  "permissions": {
    "chat": true,
    "operator": false
  }
}
```

规则：

- 已登录 end-user 默认投影为 `campus_member`
- `session.sessionId` 是当前 end-user path 的 canonical app-owned session
  identifier；它来自 typed auth projection，不来自 browser 自造 conversation id
- `operator` 使用 protected surface trusted identity bridge
- v1 不要求单独的 operator 用户系统或 operator session 表
- 当前 chat routes 继续要求 resolved principal；无 principal 请求返回
  `session_required`，不会创建 anonymous chat conversation

## Chat Endpoints

### `GET /api/chat/conversations`

返回当前登录用户拥有的 conversation summary 列表。

```json
{
  "conversations": []
}
```

规则：

- 默认按 `updatedAt desc`
- 只返回当前 user 的会话
- v1 不在 list 响应内内嵌完整 message history

### `POST /api/chat/conversations`

创建显式 conversation draft。

这个接口是可选入口，不是首轮消息的必经前置步骤。

响应：

```json
{
  "conversation": {
    "id": "conv_01HQ...",
    "title": "New conversation",
    "createdAt": "2026-03-28T07:10:00.000Z",
    "updatedAt": "2026-03-28T07:10:00.000Z",
    "messages": []
  }
}
```

规则：

- 第一版不要求请求 body 或客户端先提交 title
- 如果客户端只想直接发送首轮消息，可以跳过这个接口，直接调用 `POST /api/chat/requests`
- title 可以在首轮问答后由服务端回填

### `GET /api/chat/conversations/:conversationId`

返回当前用户拥有的 conversation detail。

```json
{
  "conversation": {
    "id": "conv_01HQ...",
    "title": "图书馆开放时间",
    "createdAt": "2026-03-28T07:10:00.000Z",
    "updatedAt": "2026-03-28T07:11:00.000Z",
    "messages": []
  }
}
```

### `DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing`

删除指定 message 起始的 trailing message 段，用于 donor-style message edit。

响应：

- `204 No Content`

规则：

- `conversationId` 必须属于当前登录用户
- `messageId` 必须属于该 conversation
- 服务端删除范围是 `createdAt >= 目标 message.createdAt`
- 这个接口只负责截断现有对话尾部，不负责写入编辑后的新 user message
- 编辑后的新 user message 仍由后续 `POST /api/chat/requests` 在 canonical command path
  中生成新 answer

### `POST /api/chat/requests`

这是 public chat 的同步命令入口。

当前 `public-chat-web` 只 admission `knowledge` capability。这里描述的是该 surface 当前开放的
capability allowlist，不是长期产品入口原则；前向 routing 语义见
`docs/architecture/system/capability-routing-and-admission-architecture.md` 与 `docs/dec
isions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-pol
icy.md`。

请求 headers：

- `Content-Type: application/json`
- `Idempotency-Key: <opaque-key>` 可选但推荐

请求 body：

```json
{
  "prompt": "图书馆开放到几点？",
  "requestedCapability": "knowledge",
  "requestedScope": {
    "corpus": "regulations",
    "collection": "student_rules"
  },
  "versionQuery": {
    "mode": "as_of",
    "asOf": "2024-06-01"
  }
}
```

字段规则：

- `conversationId` 可选；如果提供且已属于当前 user，则继续向该 conversation 追加消息
- `conversationId` 可选；如果提供但当前 user 还没有这个 conversation，`app-api` 会在同一条 command
  path 内用这个 id 建立首轮 conversation
- 如果未提供 `conversationId`，`app-api` 仍可在同一条 command path 内 lazy create
  conversation，并返回 canonical conversation id
- `prompt` 必填，服务端会 trim 并做最小长度校验
- `requestedCapability` 可选；当前 public chat 只接受 `knowledge`。这是 current surface
  posture，不表示长期产品入口必须 `knowledge-only` 或 `RAG-first`
- `requestedScope` 可选；它只属于 knowledge-family path。未提供时 `app-api` 不得伪造默认 serving
  surface，最终 scope 由 downstream specialist 解析，并在 finalized projection /
  observability 中回填 `resolvedScope`
- `versionQuery` 可选；它只属于 knowledge-family path，用 `camelCase` 传
  `mode`、`asOf`、`versionId`、`compareToVersionId`
- `versionQuery.mode` 允许 `current`、`historical`、`as_of`、`compare`
- `versionQuery.asOf` 只允许与 `mode=as_of` 一起出现；`versionQuery.versionId` 只允许与
  `historical|compare` 一起出现；`compareToVersionId` 只允许与 `compare` 一起出现，且要求同时提供
  `versionId`
- `versionQuery` 参与 `Idempotency-Key` 对应的 request fingerprint；同一 prompt/scope
  但不同 version query 不能共享同一个幂等结果

成功响应：

```json
{
  "answer": {
    "conversation": {
      "id": "conv_01HQ...",
      "title": "图书馆开放时间",
      "createdAt": "2026-03-28T07:10:00.000Z",
      "updatedAt": "2026-03-28T07:11:00.000Z",
      "messages": []
    },
    "result": {
      "kind": "answer",
      "text": "图书馆开放到 22:00。",
      "requestId": "req_01HQ...",
      "traceId": "trace_01HQ..."
    }
  }
}
```

`result.kind` 允许以下分支：

- `answer` 返回 `text`
- `clarification` 返回 `text`
- `no_answer` 返回 `text`
- `error` 返回 `message`、`errorCode`、`retryable`

规则：

- v1 不做 streaming；这个接口默认同步返回最终 chat-visible 结果
- 请求一旦被接受并分配 canonical `requestId`，后续执行失败仍通过 `200 + result.kind=error` 返回，以保留
  correlation 与 durable request record
- pre-accept 拒绝仍走统一 error envelope

## Operator Endpoints

### `GET /api/operator/requests`

查询参数：

- `limit`
- `cursor`
- `status`
- `surface`
- `conversationId`
- `requestId`

响应：

```json
{
  "requests": [],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 默认 `limit=20`
- 最大 `limit=100`
- 结果按 `startedAt desc`
- 只读取 `operator.request_projection`
- 不回放 answer execution

### `GET /api/operator/requests/:requestId`

响应：

```json
{
  "request": {
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
    "resolvedScope": {
      "corpus": "regulations",
      "collection": "student_rules"
    },
    "selectedTarget": "rag-agent",
    "questionPreview": "图书馆开放到几点？",
    "answerPreview": "图书馆开放到 22:00。",
    "errorCode": null,
    "sourceDocIds": ["handbook:library-hours"],
    "startedAt": "2026-03-28T07:10:30.000Z",
    "completedAt": "2026-03-28T07:10:31.000Z",
    "durationMs": 842,
    "projectedAt": "2026-03-28T07:10:31.500Z"
  }
}
```

规则：

- 这是 projection detail，不是 raw execution dump
- `requestedScope` 表示调用方显式请求的 knowledge-family scope，可为 `null`
- `resolvedScope` 表示 specialist 最终解析并执行的 serving scope，是 operator/panel 侧的前向真相
- 细节页允许比 list 多出 `errorMessage`、`followUpQuestion`、`confidence` 或 `sourceDocIds`
- v1 不暴露 raw prompt、raw answer 全量、raw audit JSONL 或 specialist-internal payload

## Explicit Non-Goals

- 不把已退役 standalone chat app 的旧 `/api/answer` 继续提升为 forward contract
- 不为 panel 暴露 database/admin-console 风格 API
- 不让 operator endpoints 旁路读取 `runtime.request_execution`
- 不把 `packages/contracts` 直接当 browser product API
