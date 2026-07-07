---
doc_type: contract
truth_scope: product
owner_boundary: apps/app-api
status: active
created: 2026-03-28
updated: 2026-06-15
---
# App API Request Lifecycle

## 文档边界

这份文档冻结 `POST /api/chat/requests` 与 `POST /api/chat/requests/stream`
的生命周期、幂等规则、状态流转，以及 request projection 如何进入 operator read model。

它补充但不替代以下文档：

- 产品层 HTTP contract：`docs/contracts/app-api/README.md`
- internal eval ingress contract：`docs/contracts/app-api/eval-benchmark.md`
- `app-api -> execution-control`
  契约：`docs/contracts/tool-execution.md`
- error model：`docs/contracts/app-api/error.md`
- 数据模型：`docs/data/app-api/README.md`
- durable agent runtime contract：`docs/contracts/durable-runtime.md`
- request projection
  ownership：`docs/architecture/system/product-runtime.md`

## Lifecycle Conclusion

当前请求链路固定为：

1. `app-api` 解析 session / trusted operator identity
1. 解析已有 conversation 或为首轮请求准备 lazy create，并校验请求体
1. 生成 canonical `requestId` 与 `traceId`
1. 在同库 command boundary durable 写入 `runtime.request_execution` 与首个
   `runtime.projection_outbox` 事件
1. 调用 `apps/execution-control`
1. 写回最终 execution outcome，并追加最终 `runtime.projection_outbox` 事件
1. projector 在同一 `app-api` boundary 内物化 `operator.request_projection`
1. panel 只通过 `GET /api/operator/requests*` 读取 projection

这里冻结的重点是：

- durable request facts 必须在 `app-api` command path 内产生
- canonical projection input 必须先以 database outbox 形式 durable 提交
- projection read model 可以异步物化
- panel 不得通过同步回放 answer execution 来补 operator query

## State Model

`runtime.request_execution.status` 第一版固定允许：

- `accepted`
- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`
- `cancelled`

状态语义：

- Status: `accepted`
  Meaning: 请求已 durable 接受，但最终执行结果尚未写回
  Chat-visible result: 无；仅内部短暂状态

- Status: `completed`
  Meaning: 返回 grounded answer
  Chat-visible result: `answer`

- Status: `needs_clarification`
  Meaning: 返回追问问题
  Chat-visible result: `clarification`

- Status: `no_answer`
  Meaning: 安全地无法给出 grounded answer
  Chat-visible result: `no_answer`

- Status: `error`
  Meaning: 请求被接受，但执行或依赖失败
  Chat-visible result: `error`

- Status: `approval_required`
  Meaning: execution policy 要求先人工审批
  Chat-visible result: `error`

- Status: `rejected`
  Meaning: code-owned gate 明确拒绝本次请求；包括 execution policy reject 与 app-api
  precheck fail-close reject
  Chat-visible result: `error`

- Status: `cancelled`
  Meaning: execution 已接受 explicit cancel 或 upstream cancel 并停止等待
  Chat-visible result: `error`

`running` / `queued` 不写入 `runtime.request_execution.status`；它们只作为 lifecycle
stream event 暴露给当前浏览器请求。

Forward run projection 说明：

- 最终 production execution status 不再由 `runtime.request_execution.status` 单独承载
- answer-level execution truth 迁移到 durable `Run`
- product streaming 迁移为 run event subscription
- current request lifecycle 在 cutover 前继续作为 app-api request projection truth

## Command-Side Sequence

### Step 1: Admit

`app-api` 完成：

- session / principal lookup
- conversation resolution
- 如果请求体携带 `conversationId`，先校验 ownership
- 如果请求体未携带 `conversationId`，标记为首轮请求并准备 lazy create
- prompt normalize
- `Idempotency-Key` 校验
- canonical `requestId` / `traceId` 分配

如果此时失败：

- 直接返回 HTTP error envelope
- 不创建 `runtime.request_execution`

当前冻结说明：

- online answer request path 继续要求 resolved end-user principal
- 如果没有 principal，直接返回 `session_required`
- 当前不会因为缺少 principal 而创建 anonymous conversation 或 anonymous request truth

### Step 2: Durable Request Record

在第一次 command-side commit 中至少写入：

- 首轮请求缺少 `conversationId` 时，对应的 `chat.conversations`
- `chat.messages` user message
- `runtime.request_execution`
- `runtime.projection_outbox` 的 `request.accepted` 事件

此时最小状态为：

- `status=accepted`
- 已记录 `requestId`、`traceId`
- run projection cutover 后，已记录 durable `runId`
- 已绑定 conversation / verified actor projection / requested scope

当前说明：

- active chat 主路径启用后，`run_id` 不得通过 diagnostics、projection payload 或
  telemetry sink 间接承载；必须写入 `runtime.request_execution.run_id`
- 当前 cutover 进度：`POST /api/chat/requests` 与
  `POST /api/chat/requests/stream` 均在 app-api accept 后通过
  `execution-control` 创建 Temporal-backed execution run，并将真实 `run_id`
  写入 accepted / finalized `runtime.request_execution`；blocking 与 stream final
  answer commit 均从 sanitized run projection / `finalization.completed` event
  payload 产出。
- durable stream path 的 `request.accepted` 必须在 execution run create
  成功后发送；浏览器连接断开不得取消 app-api finalization closeout。
- `runtime.request_execution` finalization 只允许从 `status=accepted` 原子推进到
  terminal status；如果 request 已经被 finalized、取消或处于其他状态，finalization
  必须 fail closed，且不得插入第二条 assistant message。

### Conversation Resolution Rule

- `POST /api/chat/conversations` 是显式 draft create API，不是 `POST
  /api/chat/requests` 的前置依赖
- `POST /api/chat/requests` 如果携带 `conversationId` 且该 conversation 已属于当前 user，按
  owned conversation 继续追加消息
- `POST /api/chat/requests` 如果携带 `conversationId` 但当前 user 还没有这个
  conversation，则第一次 durable commit 直接用这个 id 建立新的 canonical conversation
- `POST /api/chat/requests` 如果未携带 `conversationId`，必须在第一次 durable commit 内创建
  canonical conversation，并把同一次请求绑定到新 conversation

### Step 3: Execute

在真正调用 `apps/execution-control` 之前，`app-api` 允许运行 repo-owned pre-execution
fail-close checks。

当前 contract 冻结为：

- 这类 precheck 发生在第一次 durable accept 之后，因此 request truth 仍然可审计
- 如果 precheck 直接拦截请求，最终状态写成 `rejected`
- 当前 abuse throttle key 固定为
  `runtime.request_execution.safety_identifier`
- throttle truth 只允许从 app-owned durable request truth 计算，不走 in-memory only
  shortcut
- 初始阈值固定为：
  - same `safety_identifier` `> 8 requests / 60s`
  - same `safety_identifier` `> 30 requests / 10m`
  - 任一 `rate_limit_exceeded` 命中后追加 `5m` temporary throttle window
- 当前 abuse throttle 命中后固定写：
  - `status=rejected`
  - `error_code=rate_limit_exceeded`
  - chat-visible result 继续走既有 `error` kind
- 这类 precheck reject 不调用 `apps/execution-control`

`app-api` 使用内部 execution contract 调用 `apps/execution-control`。当前 submit path
只调用 `POST /internal/execution/runs` 启动 Temporal workflow；终端 answer 与 streaming
均由 sanitized projection / run events 驱动，不调用 retired legacy answer transport。

该调用：

- 不暴露给 browser
- 不把 execution-control / Temporal raw event 直接暴露给 browser
- 不回写 panel projection
- 只返回 typed execution outcome
- execution origin 必须指向 Go `apps/execution-control`，而不是 Python private handoff
  worker；Docker Compose 只保留 local / transitional evidence，production target
  substrate 由 K8s + KEDA 承接

### Step 4: Finalize

第二次 command-side commit 至少写入：

- assistant message 或 safe failure message
- `runtime.request_execution` 最终状态
- 对应最终状态的 `runtime.projection_outbox` 事件
- conversation-scoped `chat.session_slots` 当前快照（仅在存在 typed confirmed session
  truth 时）

最终状态写回规则：

- `completed` 写 `answer_text` 摘要与 source identifiers
- `needs_clarification` 写 follow-up question 摘要
- `no_answer` 写 safe no-answer 摘要
- `error` 写 error code / retryable
- `approval_required` 写审批提示与最终 execution 状态，不把它折叠成 command-side `error`
- `rejected` 写拒绝原因与最终 gate 状态；既可来自 execution policy，也可来自 app-api precheck
  fail-close（例如 `rate_limit_exceeded`），但都不折叠成 command-side `error`
- `cancelled` 写 `execution_cancelled` 或 upstream cancel code；browser chat
  surface 仍以 `error` kind 展示 safe failure message

### Product Lifecycle Stream

`POST /api/chat/requests/stream` 是 browser-facing product SSE contract。

固定事件：

- `request.accepted`
- `execution.queued`
- `execution.running`
- `answer.delta`
- `request.completed`
- `request.failed`
- `request.cancelled`

固定规则：

- `request.accepted` 只能在第一次 durable request commit 完成后发送
- `execution.queued` / `execution.running` 来自 internal execution lifecycle
  event 的 product-level projection
- `answer.delta` 来自 browser-visible durable `run.answer_delta` projection，只承载
  用户可见 answer writer 文本增量；它不是 provider raw token stream，也不是最终
  answer truth
- terminal event 只能在 `app-api` 完成第二次 finalize commit 之后发送
- terminal event 的 `data.answer` 与同步 `POST /api/chat/requests` 成功 body 的
  `{ answer }` shape 保持一致
- `execution.completed` 且 semantic result 为 `needs_clarification` /
  `no_answer` 时，产品 SSE 仍用 `request.completed`，并在 `data.status` 与
  `data.answer.result.kind` 中表达语义分支
- browser 不直连 `apps/execution-control`，也不消费 raw `execution.started` /
  `execution.completed` internal event

### Session Slot Finalize Rule

`chat.session_slots` 的第一版只承载 conversation-scoped typed session truth，不承载
transcript 恢复、展示 alias 或自由文本总结。

冻结规则：

- `app-api` 只能根据 typed diagnostics 写 session truth，不能解析 assistant
  文本、clarification 文本或历史 transcript 反推 slot
- 第一版仅 curriculum follow-up lane 可以在 finalized `completed` 时写 slot
- 当前允许写入的 truth 仅限：
  - `curriculum_program_family`
  - `curriculum_program`
  - `curriculum_semester`
- 写入语义是 replace-write 当前快照，不是追加历史 slot
- 如果本轮 diagnostics 只产出部分 slot，可以与已有 confirmed slot 合并后写回，但结果仍表现为当前快照
- `app-api` 在下一轮请求里只回放这些 confirmed typed slots 到
  `context.session.confirmed_slots`

明确不写 slot 的 finalized lane：

- `needs_clarification`
- `no_answer`
- `error`
- `approval_required`
- `rejected`
- `cancelled`
- curriculum completed 但没有 typed follow-up truth
- curriculum `program_family_membership` completed
- curriculum `course_family` completed

因此，`chat.session_slots` 不是通用 conversation summary，也不是
`runtime.request_execution` 的派生缓存；它只保存后续 agent 安全可消费的 typed confirmed
state。

## Projection Rule

projection 的长期规则固定为：

- canonical truth 先进入 `runtime.request_execution` 与同库
  `runtime.projection_outbox`
- panel-facing read model 不直接由 chat response body 拼装
- `operator.request_projection` 通过 `runtime.projection_outbox` 物化

推荐链路：

`runtime.request_execution -> runtime.projection_outbox -> projector ->
operator.request_projection`

实现说明：

- 第一版优先采用 scheduled projector 或 Worker 内异步消费者直接消费数据库 outbox
- 当前 `app-api` merged truth 采用 `request success -> Worker waitUntil bounded
  drain` 与 `scheduled projector` 并存；前者负责收敛常规请求写后延迟，后者负责补偿/恢复与 deploy-side
  observability
- durable chat stream 还额外使用 request `waitUntil` 持有 app-api
  finalization closeout；该 closeout 与浏览器 stream 消费共享同一个
  finalization promise，不允许 stream consumer 与 background closeout 双写
- 该 closeout 允许通过 execution-control internal run-events query 使用 bounded
  wait budget；等待发生在 execution-control 内部 projection store 查询循环中，用于减少
  app-api Worker subrequest 消耗，不改变 app-api 的 finalization ownership，也不把
  `wait_ms` 暴露为 browser contract
- queue 只可以在 outbox commit 之后作为 fan-out / 加速手段引入
- 不接受 queue-first 再反补数据库 truth 的形态
- 但它必须仍属于 `app-api` boundary
- panel 查询不等待 projector 完成

## Consistency Rule

第一版明确接受 eventual consistency：

- chat response 可以先成功返回
- panel list/detail 可以短时间内看不到刚完成的请求
- 这不是让 panel 反查 `runtime.request_execution`、JSONL audit、telemetry sink 或
  `apps/execution-control` 的理由

## Idempotency Rule

### Scope

`Idempotency-Key` 只适用于：

- `POST /api/chat/requests`
- `POST /api/chat/requests/stream`

### Storage Rule

第一版在 `runtime.request_execution` 上至少保存：

- `idempotency_key`
- `request_fingerprint_sha256`
- `request_id`

唯一性范围固定为：

- `actor_user_id + idempotency_key`

### Replay Rule

如果收到同一个 `Idempotency-Key`：

- fingerprint 相同且原请求已完成 返回原始结果
- fingerprint 相同但原请求仍停留在 `accepted` 返回 `409 request_in_progress`
- fingerprint 不同 返回 `409 idempotency_conflict`

首轮 lazy-create 请求的 fingerprint 规则固定为：

- 在尚未分配 canonical conversation id 之前，使用稳定的 new-conversation discriminator 参与
  fingerprint 计算
- 第一版 discriminator 固定为 `__new__`
- 这样同一首轮请求在首次提交完成前后都能稳定重放，而不要求客户端先显式创建 conversation
- 对 knowledge tool request，`requestedScope` 与 `versionQuery` 都属于 fingerprint
  输入；同一 prompt 但不同历史版本锚点不得命中同一个幂等结果

`requestId` 不是幂等键。

它的职责只是：

- correlation
- panel / operator 可见 request identity
- user support reference

## Error Boundary Rule

这里固定区分两类错误：

- pre-accept error 使用 HTTP error envelope
- post-accept execution error 使用 `200 + result.kind=error`

原因：

- 一旦请求已经 durable 接受，必须保留 `requestId`
- 用户和 operator 需要能关联这次失败
- panel request projection 也需要看到这次失败请求

## Non-Goals

- 不把 panel detail 变成 execution replay 接口
- 不要求 chat response 同步等待 projection materialization
- 不用 raw log 或 telemetry sink 替代 outbox / read model
