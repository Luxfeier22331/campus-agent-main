---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-23
updated: 2026-06-23
---

# Conversation Attachment Upload PRD

## 1. 背景

`campus-web` 问答页已经使用 assistant-ui composer。当前 UI 可以显示附件入口和本地附件预览，但服务端
`/api/chat/assistant-ui` 只解析最后一条用户消息的文本，并只向 app-api chat command
链路提交 `prompt`。

这意味着当前附件按钮只是前端展示能力，不是已闭环的产品能力。正式上线附件前，系统必须把附件上传、
存储、准入、上下文投影、模型输入、历史展示和失败状态收成明确 contract。

附件上传的产品定位是：用户在某一轮对话中主动提供图片或文件作为上下文，帮助模型理解用户问题。它不是
机构知识库入口，不是官方通知/证据 source truth 入口，也不是长期个人文件库。

## 2. 目标

- 支持用户在问答 composer 中上传受支持的图片或小型文档。
- 支持附件先上传到 app-api，再由聊天请求引用 `attachment_id`，而不是把 raw file 或 base64 混进聊天请求。
- 支持 app-api 对附件进行 session、owner、conversation、MIME、大小、数量和状态校验。
- 支持 execution-control 消费 bounded attachment projection，并把附件作为当前请求上下文交给 primary
  agent 或 provider-facing activity。
- 支持图片类问题进入 provider multimodal input；支持文档类问题进入 bounded text/file context。
- 支持会话历史展示用户上传的附件 metadata、缩略图/预览状态和失败状态。
- 对不支持的附件类型、过大文件、未就绪附件、provider 不支持 multimodal/file input 等情况 fail closed。

## 3. 非目标

- 不把用户上传内容写入 institution RAG / Qdrant 默认索引。
- 不把用户附件作为官方 notice、regulation、curriculum 或 official web source truth。
- 不做长期个人文件库、文件夹、分享、搜索或跨会话资料管理。
- 不支持任意大文件、压缩包、可执行文件或批量资料 ingestion。
- 不支持用户通过附件提交事务、工单、支付、预约或状态变更。
- 不要求本期建设 operator 审核、release evidence、eval 标注或人工校对后台。
- 不在附件失败时静默退化成“只看文本继续回答”。

## 4. 用户场景

### 4.1 截图解释

用户上传一张通知截图并问“这是什么意思”。

系统应把图片作为本轮上下文传给支持视觉输入的 provider，并在回答中说明这是基于用户上传截图的解释；如果截图信息不足，应要求用户补充原文或来源。

### 4.2 图片 + 校园能力组合

用户上传一张班车截图并问“今晚六点还适用吗”。

系统可以读取截图内容，但当前状态判断仍应进入已开放的结构化校园能力或 fail closed。附件不能替代官方当前状态 source truth。

### 4.3 小型文档总结

用户上传 PDF、txt 或 markdown 并问“帮我总结重点”。

系统应在文件大小和 token budget 内生成摘要；如果文件过大或无法解析，应提示无法处理该附件，而不是忽略附件。

### 4.4 附件历史回看

用户打开历史会话时，应看到当时上传过的文件名、类型和可展示的预览信息。系统不要求重新处理全部旧附件，但不能让历史消息看起来像没有上传过附件。

## 5. 产品范围

### 5.1 支持的附件类型

首批建议支持：

- 图片：`image/png`、`image/jpeg`、`image/webp`、非动画 `image/gif`
- 文本：`text/plain`、`text/markdown`
- 文档：`application/pdf`

其他类型默认不开放。后续是否支持 docx、xlsx 或更多 Office 文件，必须单独评估提取质量、大小限制和安全边界。

### 5.2 上传与发送模型

附件必须先上传，再随消息引用：

```text
campus-web composer
-> app-api attachment upload
-> object storage raw object
-> app-api attachment metadata
-> /api/chat/assistant-ui text + attachment_refs
-> execution-control bounded attachment projection
-> agent.primary / typed capability / provider-facing activity
-> finalization.write
```

聊天请求只携带附件引用：

```json
{
  "threadId": "conversation_...",
  "messages": [],
  "attachments": [
    {
      "attachment_id": "att_...",
      "purpose": "conversation_context"
    }
  ]
}
```

实际 wire shape 由后续 contract 文档冻结。本 PRD 只定义产品要求。

### 5.3 存储与生命周期

- raw file 存入 S3-compatible object storage。
- app-api 在 PG 中保存附件 metadata：owner、conversation、message/run 绑定、MIME、大小、sha256、
  状态、object key、thumbnail/extracted text projection ref。
- 未发送的 pending 附件应有短 TTL。
- 删除会话时，附件应进入删除或不可访问状态。
- 历史展示使用 metadata 和安全预览，不直接暴露 object storage key。

### 5.4 模型上下文

系统必须区分 raw attachment、runtime-only metadata 和 model-visible projection。

model-visible projection 可以包含：

- 图片 provider input 引用或受控 data payload。
- 文档抽取后的 bounded text excerpt。
- 文件名、类型、大小等用户可见 metadata。

runtime-only metadata 包括：

- object key
- sha256
- storage bucket
- owner / principal binding
- internal extraction state
- provider file id

runtime-only metadata 不得进入 prompt。

## 6. 功能需求

### 6.1 前端 composer

- 附件入口只在后端 capability ready 时展示。
- 添加附件后必须显示上传进度、成功状态或错误状态。
- 发送消息前，所有附件必须处于 `ready` 状态。
- 不支持的 MIME、过大文件或超过数量限制时，前端应阻止并展示用户可理解错误。
- 用户可以移除 pending / ready 附件。
- 发送失败时，附件状态不得被伪装成已处理。

### 6.2 app-api 上传入口

app-api 应提供受 session 保护的附件上传入口。

要求：

- 只允许已登录用户上传。
- 校验 content type、文件大小、附件数量、conversation ownership 和 pending attachment ownership。
- 写入 object storage 前后都要维护清晰状态。
- 上传成功后返回附件 metadata 和 `attachment_id`。
- 不把 raw file 放入 chat request body。
- 上传入口失败时返回明确错误码，例如 `attachment_type_unsupported`、`attachment_too_large`、`attachment_upload_failed`。

### 6.3 chat request 准入

`/api/chat/assistant-ui` 应接受当前消息文本和 attachment refs。

要求：

- 有附件但缺少正文时是否允许，必须按产品规则显式定义；首批建议允许“附件 + 简短问题”，不允许空问题。
- 每个 attachment ref 必须属于当前 principal。
- attachment 必须处于 `ready` 或可处理状态。
- attachment 与 conversation 的绑定必须一致，或者在发送时完成一次性绑定。
- 附件不支持时 fail closed，不得忽略后继续回答。

### 6.4 execution-control 消费

execution-control 应把附件作为本轮 run context 的一个 typed slice，而不是让 RAG 或 provider adapter
各自读取 app-api 内部存储。

要求：

- 增加 `context.attachment_prepare` 或等价 step，输出 bounded attachment projection。
- primary agent 接收附件摘要、可见类型和可用能力提示。
- provider-facing activity 根据 provider profile 决定是否构造 `input_image` 或 `input_file`。
- provider 不支持图片/文件输入时，返回 typed unsupported/fail-close 结果。
- step projection 记录附件数量、类型、处理状态、provider capability 和失败原因，不记录 raw 内容。

### 6.5 图片处理

图片首批作为 multimodal input 处理。

要求：

- 图片必须符合受支持 MIME 和大小限制。
- 支持低成本默认 detail；需要阅读截图小字时允许由服务端选择更高 detail。
- 如果图片不清晰、内容不足或 provider 报错，应返回可理解失败或澄清。
- 不承诺精确空间定位、计数或医学/安全敏感图片判断。

### 6.6 文档处理

文档首批作为 bounded per-request context 处理。

要求：

- 小型 PDF/text/markdown 可进入提取或 provider file input。
- 超出预算时返回明确错误或要求用户缩小范围。
- 抽取失败时 fail closed。
- 文档内容不进入 institutional RAG。

### 6.7 历史展示

会话历史应能恢复用户消息中的附件 metadata。

要求：

- 展示文件名、类型、大小、上传/处理状态。
- 图片可展示安全缩略图或预览。
- 删除或过期附件应显示不可用状态。
- 历史加载不要求重新把所有附件加入当前模型上下文。

## 7. 安全与边界

- 默认限制单文件大小、每轮附件数量和总 payload。
- 禁止可执行文件、压缩包和未知二进制类型。
- 不从 object storage key 推导授权；所有访问必须经过 app-api ownership check。
- 不把附件内容发送到不支持或未启用的 provider。
- 不把用户附件加入官方知识库、通知源、release 证据或 operator 数据源。
- 不在 telemetry、Sentry、Axiom、Langfuse 或 projection 中记录 raw attachment content。

## 8. 验收标准

### 8.1 P0 准入

- 当前后端未支持附件时，问答页不展示附件入口。
- 如果请求携带附件但后端未开启附件能力，服务端返回明确错误，不静默忽略。
- 文档和 backlog 明确记录附件上传是 proposed backlog，不是当前 merged truth。

### 8.2 P1 图片闭环

- 用户可上传一张受支持图片并发送问题。
- app-api 存储 raw object 和 metadata。
- chat request 通过 attachment ref 引用图片。
- execution-control 投影附件准备 step。
- 支持 vision 的 provider 能收到图片输入并生成回答。
- 不支持 vision 的 provider fail closed。
- 历史会话展示图片附件 metadata / preview。

### 8.3 P2 文档闭环

- 用户可上传小型 PDF/txt/markdown 并发送问题。
- 系统能生成 bounded 文档上下文或 provider file input。
- 超大/不支持/抽取失败文档返回明确错误。
- 历史会话展示文档 metadata。

### 8.4 回归约束

- 附件不进入默认 RAG index。
- 附件失败不会被当成普通文本请求成功处理。
- conversation history 不丢失附件 metadata。
- step projection 不包含 raw file content。
