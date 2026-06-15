---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-15
---

# App API HTTP Chat

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

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
- 如果客户端只想直接发送首轮消息，可以跳过这个接口，直接调用 `POST /api/chat/requests/stream`
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
- 编辑后的新 user message 仍由后续 `POST /api/chat/requests/stream` 在 canonical command path
  中生成新 answer

### `POST /api/chat/requests`

这是 public chat 的同步兼容 / 诊断命令入口。产品默认入口与 release gate 是
`POST /api/chat/requests/stream`；同步入口会等待 durable finalization，不应用作
Cloudflare Worker 上的 RAG / memory staging closeout 标准。

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
- `requestedCapability` 可选；当前 public chat 接受已 admission 的 explicit
  capability hint，例如 `knowledge`、`campus_services`、`notice` 与仍保持
  fail-close 的 `navigation` seam
- `requestedCapability` 缺失时，`app-api` 不伪造成 `knowledge`，也不预选 tool
  plan；它只投影 surface/session/account context 与 caller hint。下游
  `execution-control` 保持 capability-neutral request envelope，并把 admitted
  visible tool set 交给 `agent.primary` 决策
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

这是 public chat 的产品默认 lifecycle streaming 命令入口。它不提供 token delta，
不暴露 `execution-control` raw event；browser 只消费 `app-api` 产品级 SSE
contract。release / staging chat smoke 默认使用该入口。

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

- run projection 启用时，`request.accepted` 在 app-api accept commit 与
  execution durable run create 均成功后发送；其 data 必须包含 `runId`
- terminal event 在 finalization commit 后发送；因此 terminal `answer` 是
  app-owned DB/projection truth 的产物
- terminal answer 可以来自 first Execution Agent decision 的 direct/no-tool branch；
  这类结果不要求 `selectedCapability` 非空，但必须携带 request/run correlation、
  trace/runtime provenance 与 terminal intent summary
- submit stream 的浏览器连接不拥有 finalization；app-api 必须通过 request
  `waitUntil` 持有同一个 durable finalization closeout，浏览器断开只停止事件消费，
  不能停止 finalization commit
- app-api durable finalization closeout 可以对 execution-control 的 internal
  run-events query 传递 bounded wait budget，以减少单次 Worker invocation 内的
  subrequest 次数；这个参数不是 browser-facing contract，browser 仍只消费本节定义的
  product SSE event
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

### `GET /api/chat/runs/:runId/steps`

返回当前用户拥有的 durable run sanitized step trajectory。

规则：

- admission 必须经过 session principal 与 local
  `runtime.request_execution.run_id` ownership gate
- 响应包含 execution-control 已脱敏的 `steps`、`attempts`、`results` 与
  app-api product `run` summary
- 该 route 不暴露 raw provider payload、raw memory text 或 machine-only event
- staging memory recall smoke 使用该 route 验证 `memory.recall` 是否完成，以及
  sanitized `memory_ref` / `selected_memory_count` 是否存在
