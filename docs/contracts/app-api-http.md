---
doc_type: contract
status: active
created: 2026-03-28
updated: 2026-04-29
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
- `machine-internal`：由 supervisor / eval / ingestion 等 trusted machine caller 调用
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
- `feedback` 不影响权限、routing、memory、serving surface 或 supervisor admission

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
- 关闭 memory projection 后，后续 execution `ContextProjection.profile_memory.items` 必须为空

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
  },
  "preflight": {
    "campusServicesProductPath": {
      "status": "ready",
      "capabilityGate": "open",
      "projectionSource": "postgres",
      "checks": {
        "serviceStatusProjection": "ready",
        "serviceStatusReadModel": "ready",
        "transportSchedule": "ready",
        "transportScheduleReadModel": "ready",
        "serviceGuideProjection": "ready",
        "serviceGuideReadModel": "ready",
        "contactDirectoryProjection": "ready",
        "contactDirectoryReadModel": "ready",
        "structuredQueryRuntime": "ready"
      },
      "blockers": {}
    }
  }
}
```

当 runtime config 缺失时，返回 `503 dependency_not_ready`，并在 `details.missing` 中列出缺失键。

`preflight.campusServicesProductPath` 是 public/chat campus services opening gate
的诊断块。
它不改变 `app-api` 对非 campus-services 产品路径的基础 readiness 语义；当 status 为
`blocked` 时，`blockers` 会指出具体 gate / projection / read-model 缺口。

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

## Profile Memory Endpoints

这些接口是当前 signed-in end-user 的 profile memory 控制面。

### `GET /api/me/profile-memory`

返回当前用户 profile memory projection setting 与 user-visible memory items。

```json
{
  "profileMemory": {
    "enabled": true,
    "items": [
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
    ]
  }
}
```

### `POST /api/me/profile-memory/items`

Upsert 一个用户声明的 profile memory item。

```json
{
  "key": "recent_goal",
  "value": "准备保研材料"
}
```

返回：

```json
{
  "item": {
    "itemId": "mem_01HQ...",
    "key": "recent_goal",
    "value": "准备保研材料",
    "sourceType": "user_declared",
    "confidence": "low",
    "visibility": "user_visible",
    "lastVerifiedAt": "2026-04-27T00:00:00.000Z",
    "updatedAt": "2026-04-27T00:00:00.000Z"
  }
}
```

### `PATCH /api/me/profile-memory/settings`

打开或关闭 profile memory projection。

```json
{
  "enabled": false
}
```

返回：

```json
{
  "profileMemory": {
    "enabled": false
  }
}
```

### `DELETE /api/me/profile-memory/items/:itemId`

删除当前用户名下的 profile memory item。

```json
{
  "deleted": true
}
```

规则：

- 所有接口都要求 resolved session principal
- memory item `key` 使用小写 typed key，并拒绝 authorization / permission / ACL 类 key
- `profileMemory.enabled=false` 不删除已有 item，但 execution projection 必须返回空 memory
- 删除 item 后，该 item 不得再进入后续 `ContextProjection.profile_memory.items`
- profile memory 不进入 authorization filter、serving surface、approval 或 tool permission

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

### `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`

提交或修改当前用户对单条 assistant answer 的质量反馈。

请求 body：

```json
{
  "vote": "unhelpful",
  "reasonCodes": ["wrong_intent"]
}
```

响应：

```json
{
  "feedback": {
    "feedbackId": "fb_01HQ...",
    "messageId": "msg_01HQ...",
    "vote": "unhelpful",
    "reasonCodes": ["wrong_intent"],
    "createdAt": "2026-04-29T08:00:00.000Z",
    "updatedAt": "2026-04-29T08:00:00.000Z"
  }
}
```

规则：

- `conversationId` 必须属于当前登录用户
- `messageId` 必须属于该 conversation
- target message 必须是 assistant message，且有 non-null `requestId`
- assistant `kind=error` 不接受 feedback
- `vote` 只允许 `helpful` 或 `unhelpful`
- `reasonCodes` 只允许和 `unhelpful` 一起出现，最多 3 个，且不能重复
- `reasonCodes` 允许：`wrong_intent`、`not_enough_detail`、
  `outdated_or_missing_source`、`incorrect_answer`、`unclear_or_hard_to_use`、`other`
- v1 不接受自由文本 comment
- 同一 owner user + assistant message 只保留 latest feedback；后续 `PUT` 覆盖原值

### `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`

撤回当前用户对单条 assistant answer 的质量反馈。

响应：

- `204 No Content`

规则：

- `conversationId` 必须属于当前登录用户
- `messageId` 必须属于该 conversation
- target message 必须是 assistant message，且有 non-null `requestId`
- 只删除当前用户自己的 latest feedback row
- v1 使用 hard delete；撤回后不计入 feedback metrics

### Answer Feedback Rollout Posture

answer feedback 是 browser-facing product signal，但 durable truth 归 `app-api`
所有。

rollout 规则：

- public-chat-web 可以关闭或隐藏 feedback UI；这只停止新的浏览器入口，不删除
  已写入的 `chat.message_feedback`
- feedback route 保持 session-principal admission，缺失登录态、cross-user
  conversation、非 assistant message、`kind=error` 或无 `requestId` 都 fail closed
- 关闭 UI 后，conversation detail 仍可以返回当前用户已有的 `feedback` state
- operator quality summary / eval candidate export 可以继续读取既有 feedback，用于
  质量分析和人工复核

rollback 规则：

- 回滚 public-chat-web UI 不回滚 `app-api` schema，不清空 feedback truth
- 如需停止采集，优先关闭浏览器 UI 或 worker route proxy；不要删除
  `chat.message_feedback`
- 如发现 feedback 写入路径异常，先保持 route fail closed，再用 operator quality
  read model 验证已写入记录是否仍可安全读取

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
  surface，最终 scope 由 downstream agent 解析，并在 finalized projection /
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

- 这个接口保持 blocking JSON contract，默认同步返回最终 chat-visible 结果
- 请求一旦被接受并分配 canonical `requestId`，后续执行失败仍通过 `200 + result.kind=error` 返回，以保留
  correlation 与 durable request record
- pre-accept 拒绝仍走统一 error envelope

### `POST /api/chat/requests/stream`

这是 public chat 的 lifecycle streaming 命令入口。它不提供 token delta，不暴露
`supervisor-api` raw event；browser 只消费 `app-api` 产品级 SSE contract。

请求 headers 与 body 复用 `POST /api/chat/requests`。

成功响应 headers：

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-store`
- `X-Accel-Buffering: no`
- `X-Request-Id: <request-id>`
- `X-Trace-Id: <trace-id>`

固定 SSE events：

- `request.accepted`
- `execution.queued`
- `execution.running`
- `request.completed`
- `request.failed`
- `request.cancelled`

事件 `data` 基础 shape：

```json
{
  "requestId": "req_01HQ...",
  "runId": "run_01HQ...",
  "traceId": "trace_01HQ...",
  "status": "running",
  "occurredAt": "2026-03-28T07:11:00.000Z"
}
```

terminal event 额外携带：

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

规则：

- durable runtime 启用时，`request.accepted` 在 app-api accept commit 与
  supervisor durable run create 均成功后发送；其 data 必须包含 `runId`
- terminal event 在 finalization commit 后发送；因此 terminal `answer` 是
  app-owned DB/projection truth 的产物
- submit stream 的浏览器连接不拥有 finalization；app-api 必须通过 request
  `waitUntil` 持有同一个 durable finalization closeout，浏览器断开只停止事件消费，
  不能停止 finalization commit
- finalization commit 只允许从 `runtime.request_execution.status=accepted`
  转为 terminal status；重复 closeout 或状态漂移必须 fail closed，不能重复插入
  assistant message / outbox / observability fact
- `request.completed` 覆盖 `answer`、`clarification`、`no_answer` 等已处理完成
  分支
- `request.failed` 覆盖 post-accept execution failure / rejected /
  approval-required browser error 展示分支
- `request.cancelled` 覆盖 explicit cancel 或 upstream cancel 分支，
  chat-visible result 仍复用 `error` kind

### `GET /api/chat/runs/:runId/events/stream`

这是 public chat 的 durable run event resume stream 入口。它订阅已有
`run_id` 的 browser-visible run event projection，不创建新 request，不重新执行 agent，
也不重新 finalization。当前实现是 bounded continuous subscription：服务端按
`after_sequence` cursor 轮询新事件，遇到 terminal event 后关闭；如果订阅预算内没有
terminal event，也会关闭，client 必须用最后已消费 sequence 重新连接。

查询参数：

- `after_sequence`: 可选 non-negative integer；存在时只返回 sequence 大于该值的
  browser-visible run events

成功响应 headers：

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-store`
- `X-Accel-Buffering: no`
- `X-Run-Id: <run-id>`
- `X-Request-Id: <request-id>`
- `X-Trace-Id: <trace-id>`

每个 SSE event 的 event name 等于 durable `eventType`，data 是 app-api
browser-visible run event projection：

```json
{
  "eventId": "event_01HQ...",
  "eventType": "finalization.completed",
  "occurredAt": "2026-06-04T01:02:06.000Z",
  "payload": {},
  "runId": "run_01HQ...",
  "sequence": 3,
  "visibility": "browser"
}
```

固定规则：

- admission 必须经过 session principal 与 local `runtime.request_execution.run_id`
  ownership gate
- 该 endpoint 只能输出 `visibility=browser` 的 event projection
- 空 stream 是合法响应；它表示订阅预算内没有新的可见事件，不表示 run terminal
- reconnect / resume 只能读取 run event stream，不得重新执行同一个 run；retry /
  repair 必须创建新的显式 run

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
- `resolvedScope` 表示 agent 最终解析并执行的 serving scope，是 operator/panel 侧的前向真相
- 细节页允许比 list 多出 `errorMessage`、`followUpQuestion`、`confidence` 或 `sourceDocIds`
- v1 不暴露 raw prompt、raw answer 全量、raw audit JSONL 或 agent-internal payload

## Explicit Non-Goals

- 不把已退役 standalone chat app 的旧 `/api/answer` 继续提升为 forward contract
- 不为 panel 暴露 database/admin-console 风格 API
- 不让 operator endpoints 旁路读取 `runtime.request_execution`
- 不把 `packages/contracts` 直接当 browser product API
