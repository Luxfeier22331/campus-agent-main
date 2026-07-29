---
doc_type: contract
owner_boundary: apps/app-api
status: active
---

# Chat HTTP 合同

## 边界

`apps/app-api` 负责 conversation、message、run 关联、archive/pin/delete、答案反馈和编辑截断。
campus-web 只渲染投影并通过本文接口发送命令。

默认问答使用 app-api 持久生命周期 SSE：`POST /api/chat/requests/stream` 创建或继续 run，
`GET /api/chat/runs/:runId/events/stream` 恢复事件消费。本文不定义 provider raw token stream、
分享导出、附件上传、批处理或浏览器本地会话状态。

## 鉴权

- 所有接口要求具有 chat access 的 end-user session principal；
- conversation 和 run 只能由当前用户访问；
- soft-deleted conversation 不进入列表、搜索或详情；
- 搜索不匹配 raw trace、source ref、provider internal 或内部错误；
- 错误使用 `error.md` 的共享 envelope。

## 会话

```ts
type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  pinnedAt: string | null;
};
```

pinned conversation 排在其他 conversation 前，组内按 `updatedAt desc`。默认侧边栏只显示
`active`，archived conversation 通过账号历史管理入口访问。

### 列表和搜索

- `GET /api/chat/conversations`
  - `view=active|archived`，默认 `active`；
  - `limit` 默认 50，最大 100；
  - 不内嵌 message history。
- `GET /api/chat/conversations/search`
  - `q` trim 后必须非空；
  - `view` 同列表；
  - `limit` 默认 20，最大 50；
  - 只搜索 title 和 message text。

### 创建和详情

- `POST /api/chat/conversations` 创建显式 draft；浏览器也可以跳过该接口，直接提交首个 prompt；
- `GET /api/chat/conversations/:conversationId` 返回未删除详情、message 和 feedback 状态。

### 重命名、删除和状态

- `PATCH /api/chat/conversations/:conversationId`：`title` trim 后长度 1 到 80；
- `DELETE /api/chat/conversations/:conversationId`：soft delete，不等于物理清理；
- `POST|DELETE /api/chat/conversations/:conversationId/archive`：归档或取消归档；
- `POST|DELETE /api/chat/conversations/:conversationId/pin`：置顶或取消置顶。

### 编辑截断

`DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing` 删除目标 message 及
其后全部 message。编辑并重发是两个命令：先截断，再以修改后的 prompt 调用 stream request。

## 答案反馈

- `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`

`vote` 允许 `helpful|unhelpful`；`reasonCodes` 只适用于 `unhelpful`。error message 不接受
反馈。

反馈记录保存在 app-api：

- 隐藏 campus-web 入口只停止新增，不删除 `chat.message_feedback`；
- 未登录、跨用户、非 assistant、`kind=error` 或缺少 `requestId` 必须失败关闭；
- conversation detail 可以继续返回已有反馈；
- 导入 Langfuse/eval 必须另有明确合同，不能隐式变成发布结论；
- 回滚优先关闭前端入口或 Worker proxy，不删除 schema 或历史行。

## 提交问答

两个提交接口都接受 `Idempotency-Key` 请求头。`requestId` 是业务请求关联标识，`traceId`
是运行轨迹关联标识；成功响应通过 `x-request-id` 和 `x-trace-id` 返回二者。

### `POST /api/chat/requests`

同步诊断入口；产品默认仍为 stream。

```ts
type ChatRequest = {
  conversationId?: string;
  prompt: string;
};
```

- 缺少 `conversationId` 时 app-api 可以在同一路径创建 canonical conversation；
- `prompt` trim 后必须非空；
- public chat 不接受 routing 字段；
- execution-control 提供已准入 tool catalog，Primary Agent 决定是否调用；
- 当前评测运行器使用同一公开产品路径，不强制指定工具；
- accept 后的执行失败保留 request/run 关联并返回 chat-visible error；accept 前拒绝使用共享错误
  envelope。

### `POST /api/chat/requests/stream`

请求体与同步入口相同。该接口流式发送 app-api 产品事件，不发送 provider 或 execution-control
原始事件。

固定 browser-visible event：

- `request.accepted`
- `execution.queued`
- `execution.running`
- `answer.delta`
- `request.completed`
- `request.failed`
- `request.cancelled`

规则：

- 产品 accept transaction 提交并取得可管理的稳定 `runId` 后发送 `request.accepted`；该事件不
  表示 Temporal 已排队，app-api 只把持久 `run.queued` 证据转换为 `execution.queued`，不能自行
  合成排队状态；
- `answer.delta` 只来自持久 `run.answer_delta` 投影，用于显示，不代表最终答案；
- finalization transaction 完成后才能发送 terminal event；
- execution-control 的浏览器 `run.canceled` 只有在产品取消终态提交后才转换为
  `request.cancelled`；
- 浏览器断开只停止消费，不取消 finalization；
- 已发送 delta 后，终态不得再次把完整答案伪造成 delta。

## Run 命令与读取

### 取消

`POST /api/chat/runs/:runId/cancel` 只允许当前用户取消未终态 run。终态返回
`run_already_terminal` 类型化、不可重试错误；成功固定返回 `202`，只表示取消命令已被产品侧持久
接收，不表示 run 已取消。客户端必须保留 active run 与事件订阅，只有
`request.cancelled`、`request.completed` 或 `request.failed` 才能结束本地运行状态；成功请求不生成
答案。

### 摘要

`GET /api/chat/runs/:runId` 返回当前用户可见的产品 run 摘要，不暴露 execution-control 原始
存储。

### 事件列表

`GET /api/chat/runs/:runId/events?after_sequence=<n>` 返回 cursor 后 browser-visible 持久事件，
不创建请求或重新执行。app-api 使用 execution-control 的 `next_sequence` 推进内部读取位置，
不能以过滤后最后一个 browser event 的 sequence 代替。

### 事件续传

`GET /api/chat/runs/:runId/events/stream?after_sequence=<n>` 对既有 run 建立有界连续订阅：

- 不创建请求、不重新执行或重新 finalization；
- 浏览器从服务端返回的持久 sequence 恢复；
- terminal completed 只通知完成，最终答案从 conversation detail 的 app-owned projection 读取；
- 空流表示订阅预算内没有新事件，是合法结果。

### 步骤轨迹

`GET /api/chat/runs/:runId/steps` 返回当前用户可见的受控 `run`、`steps`、`attempts` 和
`results`。它不是 execution-control raw passthrough，可用于验证 memory recall 等步骤，不依赖
答案正文。

## 可执行来源

- `apps/app-api/src/app/routes/chat.ts`
- `apps/app-api/src/modules/runtime-command/`
- `apps/app-api/src/db/schema/chat.ts`
- `apps/campus-web/src/features/conversation/`
