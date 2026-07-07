---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-21
updated: 2026-06-28
---

# Run Context PRD

## 1. 背景

校园问答需要支持真实多轮追问。用户常用“这个”“那上一条”“刚才第二点”等表达引用上一轮回答或证据。
如果服务端只依赖当前 prompt、前端 messages 或零散 runtime state，RAG rewrite、evidence reuse、
memory recall 和 final answer 都会出现边界漂移。

本 PRD 定义服务端 run context 的产品要求：app-api 负责编译 sanitized
`context.conversation` envelope，execution-control 在接收后执行 memory recall、
primary agent、typed tool / RAG 和 finalization。RAG follow-up 是第一消费者，但不是
context schema owner。

## 2. 目标

- 服务端重建每轮模型可见上下文，不依赖前端原样传入完整 messages。
- app-api 编译当前用户消息、recent turns、上一轮回答摘要、上一轮 evidence refs、
  session state、visibility、budget 和 truncation summary。
- execution-control 在接收 context 后按 memory gate 执行 Hindsight recall。
- primary agent 能区分当前请求、历史对话、长期记忆、session state、工具结果和 RAG
  evidence。
- RAG 能对“这个 / 那个 / 上一条 / 第二点”等追问做指代消解和 query rewrite。
- 上一轮 selected evidence 可以被安全复用。
- 上下文 token budget、裁剪和 truncation reason 可诊断。
- Langfuse 只记录 sanitized context summary、hash、counts 和 categorical state。

## 3. 非目标

- 不重构整个 agent framework。
- 不照搬 monolithic middleware 模式。
- 不改变 Hindsight 作为长期个人记忆 runtime 的定位。
- 不把 PostgreSQL profile memory projection 当作 online memory recall truth。
- 不把 PostgreSQL 全量历史消息无条件塞给模型。
- 不把前端 payload 作为 conversation truth。
- 不要求本 PRD 定义完整 regenerate branch UI 或完整 conversation graph 编辑。
- 不把 RAG、provider SDK、Temporal internal、Qdrant 或 Langfuse SDK 类型泄漏进
  execution wire contract。

## 4. 产品模型

```text
app-api builds context.conversation provenance envelope
-> execution-control admits and validates the envelope
-> context.memory_recall enriches the run when enabled
-> primary agent / typed tool / RAG consume typed model-visible slices
-> finalization and Langfuse consume sanitized summaries
```

不可协商原则：

- `context.conversation` 是唯一 execution wire 目标，不新增 top-level
  `conversation_context`。
- RAG 是第一消费者，不是 context schema owner。
- Context packet 必须区分 model-visible 与 runtime-only 内容。
- Schema version 不支持、必填字段缺失、identity mismatch、conversation ownership
  mismatch、evidence scope mismatch 或 required ref 不存在时，默认 fail closed。

## 5. 用户场景

### 5.1 制度连续追问

用户先问“转专业条件是什么”，系统回答并引用制度。用户再问“那大一能不能申请”。

系统应知道“那”指上一轮转专业制度，并围绕上一轮 evidence 和当前追问进行检索或回答。

### 5.2 追问上一轮证据

用户问“刚才你引用的第二条原文是什么”。

系统应定位上一轮 selected evidence 中对应条目。无法定位时，应要求用户明确材料，而不是编造引用。

### 5.3 跨能力追问

用户先查通知，再问“这个和奖学金申请有冲突吗”。

系统应保留上一轮 selected notice / evidence 摘要，并允许本轮 RAG 结合新问题检索制度材料。

### 5.4 快速连续发送

用户在同一 conversation 中连续发送两条消息。

系统应按 message / run 绑定和 turn sequence 处理，后完成的旧 run 不得覆盖更新的 active state。

## 6. Context Source Mapping

- current user message：来自 accepted app-api user message；model-visible。
- recent turns：来自 app-api conversation messages；model-visible, sanitized。
- previous answer summary：来自 assistant message text / summary projection；model-visible。
- previous evidence refs：来自 assistant structured parts 与 runtime projection；
  model-visible bounded metadata / excerpt。
- previous tool results：来自 sanitized run / step / result projection；只暴露 refs /
  bounded summary。
- session state：来自 conversation session slots；部分 model-visible。
- actor / authz / retrieval filter：来自 resolved principal authorization projection；
  runtime-only。
- long-term personal memory：来自 execution-control 调用 Hindsight recall；model-visible
  bounded recall output。
- trace / request / run identity：runtime-only，用于 trace、eval 和 diagnostics。

## 7. 功能要求

### 7.1 Run Context Assembly

- app-api 必须在 accepted user message 已持久化后 assembly。
- `context.conversation` 必须包含 conversation / message / run identity、current user
  message、recent turns、previous answer summary、previous evidence refs、previous tool
  result refs、session state、visibility、budget 和 truncation。
- Context 读取必须验证当前用户对 conversation 的访问权限。
- `context.memory.enabled` 缺失或为 false 是合法 skipped case。
- Gate 为 true 时，memory recall 所需字段缺失必须 fail closed。
- Envelope 不包含 Hindsight recall result；recall result 由 execution-control enrichment
  产生。

### 7.2 Execution Contract

- Final wire shape 由 tool execution OpenAPI / schema 冻结。
- Run context 必须纳入 execution `context.conversation`。
- Contract 不得泄漏 Qdrant、Temporal internal、provider SDK、Hindsight internal bank id
  或 Langfuse SDK 类型。
- Schema version、recent turn count、previous evidence count、token estimate 和
  truncation reason 必须可观测。

### 7.3 Model-visible Slices

- Primary agent 输入必须区分当前用户问题、历史对话、长期记忆、工具结果和 RAG evidence。
- 历史对话只能作为上下文，不得覆盖当前用户请求。
- 当前请求和历史信息冲突时，优先当前请求，并保留冲突诊断。
- Actor / authz / trace / run metadata 不得作为自然语言上下文注入模型。

### 7.4 RAG Follow-up Rewrite

- RAG rewrite 必须使用 current question、recent turns、previous answer summary、
  previous evidence refs、session state 和 completed memory recall。
- Rewrite 输出必须包含 standalone query、retrieval intent、resolution state、
  ambiguity reason、follow-up reference 和是否需要新检索。
- `resolution_state` 只允许 `resolved`、`ambiguous` 或 `unresolved`。
- Resolve 不到时默认要求澄清；不能猜测。
- Langfuse 只能记录 query hash、resolution state 和 categorical follow-up summary。

### 7.5 Previous Evidence Reuse

- 追问上一轮 evidence 局部内容时，优先使用上一轮 selected evidence proof ref。
- 新问题中，上一轮 evidence 只能作为辅助上下文，不能替代新检索。
- Evidence ref 必须保留 source id、document id、version / snapshot metadata、access
  scope 和 content hash。
- 缺 source / version / access / hash proof 时不得复用。
- Final answer 必须能区分上一轮 evidence 与本轮检索来源。

### 7.6 Budget And Truncation

- app-api envelope budget 覆盖 current message、session state、selected evidence
  metadata / excerpt、recent turns 和 answer summaries。
- execution-control final model input budget 在 memory recall / tool result
  enrichment 后再执行。
- 超预算必须记录 truncation reason。
- 第一版可使用 deterministic truncation；不要求自动摘要。
- Token estimate 与 actual usage 应进入 trace / eval artifact。

### 7.7 Turn Sequence

- 每个 user message 生成独立 run。
- Run 必须绑定 `user_message_id`。
- Assistant 写回必须绑定 parent user message。
- Mutable active state 更新必须检查 turn sequence。
- 后完成的旧 run 不得覆盖新 run 的 selected evidence、session state、context summary 或
  active branch pointer。
- Cancel / timeout / late completion 必须保留 projection 证据。

### 7.8 Memory Merge

- Recent turns 用于当前 conversation continuity。
- Hindsight recall 用于跨会话偏好、事实、长期状态和个性化提示。
- Session slots 用于 conversation-scoped active state。
- Previous evidence 用于上一轮 RAG grounding 延续。
- 长期记忆和 recent turns 冲突时，recent turns 优先。
- `context.memory.enabled=false` 投影为 skipped；gate 为 true 但 recall 失败时当前
  workflow fail closed。

## 8. 验收标准

- 固定测试集中的“这个 / 那个 / 上一条 / 第二点”追问通过。
- Golden run context envelope fixture 可由 app-api compiler 稳定生成。
- app-api-generated `context.conversation` fixture 不包含 Hindsight recall result。
- Valid skipped fixture 覆盖 `context.memory.enabled` 缺失 / false。
- Malformed fixture 覆盖 top-level `conversation_context` 被拒绝、缺 provenance、gate 为
  true 但 recall input 缺失，以及 Langfuse forbidden payload。
- RAG trace 可看到 query rewrite hash、resolution state、follow-up reference 和 previous
  evidence decision。
- Trace 不包含 standalone query 明文、retrieved snippet 或 source body。
- 同一 conversation 连续两条消息不会互相覆盖 active state。
- 超过 token budget 时有明确 truncation reason。
- 至少一条 integration smoke 覆盖多轮追问进入 RAG 的完整路径。
- 至少一条 non-RAG / direct answer smoke 覆盖 context 进入 primary agent 的路径。

## 9. 成功指标

- 多轮追问准确率提升。
- RAG follow-up recall 提升。
- Previous evidence reuse 命中率可解释。
- 无依据回答率下降。
- 单轮平均 latency 和 token 成本增幅可解释。
- Trace 能复现每一次上下文装配和裁剪决策。

## 10. 相关文档

- [Current Architecture](../architecture/current.md)
- [Execution Agent Layer](../architecture/system/execution-agent-layer.md)
- [Tool Execution Contract](../contracts/tool-execution.md)
- [Memory Plane](../architecture/system/memory-plane.md)
- [Retrieval Serving](../architecture/system/retrieval-serving.md)
- [Langfuse Runtime Contract](../contracts/langfuse-runtime.md)
- [Langfuse Eval Platform](./langfuse-evals.md)
