---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-21
updated: 2026-06-21
---

# Run Context Envelope And RAG Follow-up PRD

## 1. 背景

当前在线问答链路已经具备用户消息持久化、Temporal 编排、Hindsight 长期记忆召回、
RAG 检索、证据合成、finalization projection 与 Langfuse eval 基础能力。

但服务端还缺少一个稳定的 run context envelope。进入模型和能力分支时，
系统主要依赖当前用户请求、session slots、memory recall 与本轮 evidence。最近多轮
对话、上一轮回答、上一轮 evidence、上一轮 capability result 尚未形成统一的
typed、sanitized、budgeted、traceable context packet。

这会影响典型多轮追问：

- “这个呢？”
- “上一条制度里的条件是什么？”
- “刚才那个通知适用于大一吗？”
- “你刚才说的第二点展开一下。”

成熟多用户 agent 产品通常由服务端按 conversation / message / run / branch 重建
模型可见上下文，再结合 memory、tools、RAG evidence 组成最终模型输入。聊天持久化、
运行时状态和模型可见上下文必须分层管理。

本 PRD 定义服务端 Run Context Envelope 的产品要求和验收标准。Conversation
Context Compiler 是 app-api 的装配动作；`context.conversation` envelope 才是被
execution contract 冻结并被 runtime 消费的目标产物。RAG follow-up 是第一阶段核心
验收场景，但不是 envelope 的能力边界或 schema owner。当前 accepted topology、
runtime owner、wire contract 与具体实现进度仍由对应 architecture / contract /
current truth 文档负责。

## 2. 目标

- 支持服务端重建每轮模型可见上下文，不依赖前端原样传入完整 messages。
- 支持 app-api 编译 `context.conversation` envelope：当前用户消息、recent turns、
  上一轮回答摘要、上一轮 evidence proof refs、上一轮 capability result refs、
  session state、visibility、budget 与 truncation summary。
- 支持 execution-control 在已接收 context packet 后，按 `context.memory.enabled` gate
  执行 `context.memory_recall`，再继续 `agent.primary`、RAG graph 与 finalization。
- 支持 primary agent 区分当前用户请求、历史对话、长期记忆、session state、工具结果和
  RAG evidence。
- 支持 RAG 作为第一消费者，对“这个 / 那个 / 上一条 / 第二点”等追问做指代消解和
  query rewrite。
- 支持上一轮 selected evidence / capability result 在下一轮追问中被安全复用。
- 支持上下文 token budget、裁剪、摘要预留和可诊断 truncation reason。
- 支持同一 conversation 下连续消息、重试、取消和 regenerate 的顺序与分支语义。
- 支持 Langfuse 记录上下文装配、query rewrite、evidence reuse 与 eval score。
- 保持当前 Temporal + typed capability 架构，不把 RAG 细节泄漏到顶层 agent contract。
- 保持 context envelope capability-neutral，不让 RAG、notice、navigation、services 或
  direct answer 各自发明上下文拼接逻辑。

## 3. 非目标

- 不重构整个 agent framework。
- 不照搬 Open WebUI 的 monolithic middleware 模式。
- 不改变 Hindsight 作为长期个人记忆 runtime 的定位。
- 不把 PostgreSQL profile memory projection 当作 online memory recall truth。
- 不把 PostgreSQL 全量历史消息无条件塞给模型。
- 不把前端 payload 作为 conversation truth。
- 不要求本期完成自动长期记忆抽取或完整 conversation summary 学习。
- 不要求本期切换到 provider stateful conversation API。
- 不要求本期引入 OpenInference 全量 prompt / completion / retrieved document schema。
- 不要求 P0 完整支持 regenerate branch UI 或完整 conversation graph 编辑。

## 4. 设计原则

### 4.0 Target Model And Non-negotiables

目标模型固定为：

```text
app-api builds context.conversation provenance envelope
-> execution-control admits and validates the envelope
-> context.memory_recall enriches the run when enabled
-> primary agent / typed capability / RAG consume typed model-visible slices
-> finalization and Langfuse consume sanitized summaries
```

不可协商原则：

- `context.conversation` 是唯一 execution wire 目标，不新增 top-level
  `conversation_context`。
- RAG 是第一消费者，不是 context schema owner。
- P0 必须包含 budget、truncation、visibility class 和 source provenance；这些不是
  P2 hardening 才补的外围能力。
- Langfuse 只接收 sanitized summary、hash、counts 和 categorical state。

### 4.1 Server-side Conversation Truth

conversation / message / title truth 属于 `apps/app-api`。浏览器提交的 assistant-ui
`messages` 最多用于提取当前输入，不得作为服务端 conversation truth 或 execution
context truth。

每轮 request accepted 后，系统应先持久化当前 user message，再从 app-api 自有
conversation store、runtime projection 与 session slots 重建当前
`context.conversation` envelope。

### 4.2 Runtime Owner Split

短期 conversation context 由 app-api 编译：

- current user message
- recent turns
- previous answer summary
- previous evidence refs
- previous capability result refs
- session state
- message / run / trace identity

长期个人记忆不由 app-api 从 PG profile memory projection 自行拼接。app-api 必须把
execution payload 需要的 `run_id`、`tenant_id`、`user_id`、`user_goal`、
`requested_capability`、confirmed `session_slots` 与 `context.memory.enabled` gate
传给 execution-control；online recall 由 execution-control 的
`context.memory_recall` activity 调用 Hindsight runtime 完成。

### 4.3 Model-visible Boundary

context packet 必须区分 model-visible 与 runtime-only 内容。

最终模型输入中的 model-visible 内容默认只包括：

- current user message
- sanitized recent turns
- previous answer summary
- previous evidence metadata / excerpt / refs
- selected session state summary
- bounded memory context returned by Hindsight recall when recall is enabled and
  completed

其中 current user message、recent turns、previous answer summary、previous evidence 与
session state 来自 app-api 生成的 `context.conversation`；bounded memory context 来自
execution-control enrichment，不属于 app-api 生成的 `context.conversation`。

Runtime-only 内容包括：

- actor / principal / entitlement / authorization projection
- retrieval filter and capability admission input
- request / run / trace identity
- memory recall request inputs and projection refs
- token estimate, truncation reason and audit metadata

runtime-only 内容不得直接注入模型。它只能用于 admission、filter、trace、eval 与
diagnostics。

### 4.4 Fail-closed Contract

schema version 不支持、必填字段缺失、identity mismatch、conversation ownership mismatch、
evidence scope mismatch、source version 不可确认或 required ref 不存在时，默认 fail
closed，并产生可诊断错误或澄清结果。不得 silent fallback 到“只看当前问题”并假装支持
多轮上下文。

## 5. 用户场景

### 5.1 制度连续追问

用户先问“转专业条件是什么”，系统回答并引用制度。用户再问“那大一能不能申请”。

系统应知道“那”指上一轮转专业制度，并优先围绕上一轮 evidence 和当前追问进行检索或
回答。

### 5.2 追问上一轮证据

用户问“刚才你引用的第二条原文是什么”。

系统应定位上一轮 selected evidence 中对应条目，返回原文或可引用摘要。无法定位时，
应说明需要用户明确是哪条材料，而不是编造引用。

### 5.3 跨能力追问

用户先查通知，再问“这个和奖学金申请有冲突吗”。

系统应保留上一轮 selected notice / evidence 摘要，并允许本轮 RAG 结合新问题检索制度
材料。

### 5.4 快速连续发送

用户在同一 conversation 中连续发送两条消息。

系统应按 message / run 绑定和 turn sequence 处理，后完成的旧 run 不得覆盖更新的
conversation active state。

### 5.5 Regenerate / Retry

用户对某轮回答执行 regenerate。

P0 只要求支持 current active chronological parent chain。完整 regenerate branch 需要
message parent / branch schema 与 active branch pointer，属于 P2 结构性能力。

## 6. 产品范围

本 PRD 覆盖以下能力：

- Run context envelope 读取、清洗、编译与重建。
- app-api 到 execution-control 的 `context.conversation` handoff 要求。
- primary agent、typed capability 与 RAG 的 typed context slice 消费。
- RAG query rewrite 与 previous evidence proof reuse。
- token budget、visibility class、裁剪与摘要预留。
- turn sequence、message branch 与并发保护。
- Langfuse trace evidence 与 eval 管理。

## 7. 当前缺口

- P0 Run context envelope 缺口：多轮追问、previous output、session state、evidence、
  budget、visibility 与 truncation 没有统一 typed envelope。
- P0 执行 payload contract 缺口：recent turns / previous outputs 没有稳定 handoff。
- P0 来源与可见性边界缺口：authz / trace / raw projection 容易被误塞进 prompt。
- P0 Memory owner 歧义：PG profile memory projection 容易被误当作 online recall
  truth。
- P1 RAG 追问理解缺口：“这个 / 那个 / 上一条”无法稳定 rewrite。
- P1 上一轮结果复用缺口：evidence / capability result 缺少可验证 proof ref，难以安全进入
  下一轮模型输入。
- P2 会话并发与分支缺口：连续消息、重试、regenerate 容易产生状态覆盖。
- P1 上下文质量 eval 缺口：无法证明补齐后多轮/RAG 效果提升。

## 8. Context Source Mapping

- current user message
  - Canonical source: accepted app-api user message / validated prompt
  - Compiler owner: app-api
  - Model-visible: yes
  - Notes: browser `messages` 只用于当前输入提取
- recent turns
  - Canonical source: app-api chat conversation messages
  - Compiler owner: app-api
  - Model-visible: yes, sanitized
  - Notes: 默认最近 3-6 轮，由 runtime config 控制
- previous answer summary
  - Canonical source: assistant message text / summary projection
  - Compiler owner: app-api
  - Model-visible: yes
  - Notes: 不注入 raw provider response
- previous evidence refs
  - Canonical source: assistant structuredParts + runtime step/result projection
  - Compiler owner: app-api
  - Model-visible: yes, bounded metadata / excerpt
  - Notes: 必须保留 source / version / snapshot provenance；不读取 Temporal history 或
    raw provider payload
- previous capability results
  - Canonical source: sanitized run / step / result projection
  - Compiler owner: app-api
  - Model-visible: yes, refs or summary only
  - Notes: typed tool result 必须已经被 projection 治理
- session state
  - Canonical source: conversation sessionSlots
  - Compiler owner: app-api
  - Model-visible: partly
  - Notes: selected slots 可见；完整 mutation / audit metadata runtime-only
- actor / authz / retrieval filter
  - Canonical source: resolved principal authorization projection
  - Compiler owner: app-api
  - Model-visible: no
  - Notes: 用于 admission / filter，不直接给模型
- long-term personal memory
  - Canonical source: Hindsight recall through execution-control
  - Compiler owner: execution-control
  - Model-visible: yes, bounded recall output
  - Notes: 只暴露 sanitized recall context；PG profile memory 不是 online recall truth
- trace / request / run identity
  - Canonical source: app-api runtime command context
  - Compiler owner: app-api / execution-control
  - Model-visible: no
  - Notes: 用于 trace、eval、diagnostics
- Langfuse trace fields
  - Canonical source: sanitized execution and context summary
  - Compiler owner: execution-control / app-api
  - Model-visible: no
  - Notes: Langfuse 不是 conversation truth

## 9. 功能需求

### FR1. Run Context Envelope Assembly

每轮执行前，系统必须从服务端存储重建当前 run 的 `context.conversation` envelope。

输入至少包括：

- `conversation_id`
- `user_message_id`
- `parent_message_id`
- `run_id`
- `user_id`
- `user_goal`
- `requested_capability`
- tenant / institution scope
- confirmed `session_slots`
- `context.memory.enabled` gate
- active parent chain selector

输出至少包括：实现阶段必须把该语义投影冻结到 execution payload 的
`context.conversation` 下，不新增 top-level `conversation_context`：

```json
{
  "context": {
    "memory": {
      "enabled": true
    },
    "conversation": {
      "schema_version": "conversation_context.v1",
      "conversation_id": "conv_...",
      "user_message_id": "msg_user_...",
      "parent_message_id": "msg_assistant_...",
      "current_user_message": {
        "role": "user",
        "content": "..."
      },
      "recent_turns": [],
      "previous_answer_summary": null,
      "previous_evidence_refs": [],
      "previous_capability_results": [],
      "session_state": {},
      "visibility": {
        "model_visible": [],
        "runtime_only": []
      },
      "memory_recall": {
        "gate_field": "context.memory.enabled",
        "owner": "execution-control",
        "runtime": "hindsight"
      },
      "source_attribution": [],
      "context_summary": null,
      "budget": {
        "token_estimate": 0,
        "recent_turn_limit": 6
      },
      "truncation": null
    }
  }
}
```

要求：

- app-api 必须在 accepted user message 已持久化后执行 context assembly。
- recent turns 默认覆盖最近 3-6 轮，具体值由 runtime config 控制。
- 上下文读取必须验证当前用户对 conversation 的访问权限。
- 只暴露 sanitized content，不携带 auth material、raw provider response、secret、
  cookie、token、Temporal history 或未经治理的 raw payload。
- assistant tool / RAG output 应保留结构化摘要、引用 id、source metadata 与必要 answer
  summary。
- P0 envelope 必须显式记录 model-visible / runtime-only visibility class。
- P0 envelope 必须记录 token estimate、budget limit 与 truncation reason；自动摘要可以后置，
  但 budget/truncation 字段不能后置。
- P0 必须能识别 current active chronological parent chain；完整 branch UI 与 branch
  selector 属于 P2。

### FR2. Execution Payload Contract 补齐

app-api 到 execution-control 的执行 payload 必须新增稳定的 run context envelope 投影。

contract source 必须遵循 execution contract 现有治理：

- 更新 `docs/contracts/schemas/capability-execution.openapi.yaml`。
- 重新生成 `apps/app-api` TS artifact 与 `apps/execution-control` Go artifact。
- 更新 valid / invalid fixture matrix。
- 通过 `pnpm contracts:check`。

要求：

- PRD 锁定语义；最终 wire shape 由 capability execution OpenAPI schema 冻结。
- run context envelope 必须纳入 execution `context` 下，作为 `context.conversation`；
  不新增 top-level `conversation_context`。
- contract 不得泄漏 Qdrant、Temporal internal、provider SDK、Hindsight internal bank id
  或 Langfuse SDK 类型。
- 必填字段缺失、schema version 不支持、identity mismatch 必须 fail closed。
- schema version、recent turn count、previous evidence count、token estimate 与 truncation
  reason 必须进入可观测字段。

### FR3. Primary Agent 使用 Envelope Slices

primary agent 输入由 `context.conversation` 的 model-visible slices 与 execution-control
后续 enrichment 组成。`context.conversation` 本身不包含 Hindsight recall result。

来自 `context.conversation` 的 model-visible slices 至少包括：

- 当前用户请求。
- recent turns。
- session slots / session state。
- 上一轮 answer summary。
- 上一轮 selected capability / evidence 摘要。

来自 execution-control enrichment 的输入包括：

- Hindsight recall 的 bounded long-term memory，仅当 `context.memory.enabled=true` 且
  `context.memory_recall` completed。

要求：

- primary agent 需要能区分当前用户问题、历史对话、长期记忆、工具结果和 RAG evidence。
- 历史对话只能作为上下文，不得覆盖当前用户请求。
- 当历史信息和当前请求冲突时，应优先当前请求，并保留冲突诊断。
- direct/no-tool final answer 也应记录上下文使用摘要，便于 eval 和排障。
- actor / authz / trace / run metadata 不得作为普通自然语言上下文直接注入模型。

### FR4. RAG Query Rewrite 使用对话上下文

RAG 检索前必须基于 `context.conversation` 与 completed execution-control enrichment 形成
retrieval intent。未完成或 skipped 的 enrichment 不得被猜测补入。

输入：

- 当前用户问题。
- recent turns。
- previous answer summary。
- previous evidence refs。
- session state。
- bounded long-term memory when `context.memory_recall` completed。

输出：

```json
{
  "standalone_query": "...",
  "retrieval_intent": "...",
  "resolution_state": "resolved",
  "ambiguity_reason": null,
  "followup_reference": {
    "type": "previous_evidence",
    "ids": ["ev_..."]
  },
  "requires_new_retrieval": true
}
```

要求：

- `resolution_state` 必须是 `resolved`、`ambiguous` 或 `unresolved`。
- “这个 / 那个 / 上一条 / 第二点 / 刚才”应尽量 resolve 到上一轮 answer 或 selected
  evidence。
- resolve 不到时，不能猜测；默认要求澄清。只有当前问题不依赖未解析指代也能独立成立时，
  才允许执行明确标注的 admitted conservative retrieval。
- query rewrite hash、followup reference、resolution state 和是否新检索必须进入 Langfuse
  trace；standalone query 明文不得进入 Langfuse。
- query rewrite 不能绕过 capability admission 或 retrieval serving surface 限制。

### FR5. Previous Evidence Proof Reuse

RAG synthesis 应能读取上一轮 selected evidence proof refs。

要求：

- 如果用户追问上一轮 evidence 的局部内容，优先使用上一轮 selected evidence proof ref。
- 如果用户提出新问题，上一轮 evidence 只能作为辅助上下文，不能替代新检索。
- 如果上一轮 evidence 已过期、不可访问、source 不存在或 scope 不匹配，必须显式诊断。
- previous evidence proof ref 必须保留 evidence id、source id、collection、snapshot /
  version metadata、access scope 与 content hash。
- 缺少 source / version / access / hash proof 时，不得复用上一轮 evidence。
- final answer 必须能说明哪些结论来自上一轮 evidence，哪些来自本轮检索。

### FR6. P0 Token Budget 与裁剪

P0 必须包含两层 token budget 与 deterministic truncation 策略。

第一层是 envelope budget，由 app-api 编译 `context.conversation` 时执行，覆盖：

1. 当前用户消息。
2. system / developer policy。
3. active session state。
4. selected evidence metadata / necessary excerpt。
5. recent user turns。
6. recent assistant summaries。
7. older turns summary。

第二层是 final model input budget，由 execution-control 在 memory recall / tool result
enrichment 后执行，覆盖最终注入 primary agent / RAG synthesis 的 model-visible
context。该层可额外纳入：

1. bounded Hindsight recall output。
2. admitted typed tool results。
3. RAG selected evidence necessary excerpt。

要求：

- evidence 原文只在 grounding 需要时注入；默认注入摘要、citation metadata 与必要 excerpt。
- 超预算时必须记录 truncation reason。
- app-api compiler 不得在 envelope budget 中预算尚未产生的 Hindsight recall result。
- 第一版可以先做 deterministic 裁剪，不强制自动摘要。
- contract 必须预留 `context_summary`，用于后续 compact / summary 方案。
- token estimate 与 actual usage 应进入 trace 和 eval artifact。

### FR7. Turn Sequence 与 Branch Control

同一 conversation 下必须明确执行语义。

要求：

- 每个 user message 生成独立 run。
- run 必须绑定 `user_message_id`。
- assistant 写回必须绑定 parent user message。
- mutable conversation active state 更新必须检查 turn sequence。
- 后完成的旧 run 不得覆盖新 run 的 selected evidence、session state、context summary 或
  active branch pointer。
- cancel / timeout / late completion 必须保留 projection 证据。
- regenerate 必须产生新的 assistant branch，不覆盖原始消息。
- P0 只要求 current active chronological parent chain；完整 branch schema 与 active branch
  pointer 属于 P2。

### FR8. 长期记忆与短期上下文合并

Hindsight recall、recent turns、session slots 和 previous evidence 必须有固定合并规则。

要求：

- recent turns 用于当前 conversation continuity。
- Hindsight recall 用于跨会话偏好、事实、长期状态和个性化提示。
- session slots 用于结构化、conversation-scoped active state。
- previous evidence 用于上一轮 RAG grounding 延续。
- 当长期记忆和 recent turns 冲突时，recent turns 优先。
- 当 session slots 和用户当前请求冲突时，当前请求触发 slot update 或澄清。
- 合并后的上下文必须可追踪每个 item 的来源。
- memory recall skip / failure 不得静默伪造空记忆。`context.memory.enabled` 缺失或为
  false 时投影为 skipped；gate 为 true 但 recall request / Hindsight recall 失败时当前
  workflow fail closed。completed-turn append failure 属于 final answer 后置 side-effect，
  不反向失败当前回答，但必须写入 failed step projection。

### FR9. Langfuse Trace Evidence

每轮执行必须记录上下文装配和 RAG 追问相关 evidence。

具体 Langfuse attribute name 由
`docs/contracts/langfuse-runtime-observability-contract.md` 冻结；本 PRD 只锁定必须可观测的
最小 semantic summary。

最小 semantic summary：

- envelope schema version。
- recent turn count。
- previous evidence count。
- previous capability result count。
- memory recall enabled / skipped / completed state。
- model-visible item count。
- runtime-only item count。
- envelope token estimate 与 truncation reason。
- source attribution count。
- query rewrite hash 或公开 fixture case id。
- query rewrite resolution state。
- follow-up reference type。
- previous evidence reuse decision。
- retrieval top-k summary。
- selected evidence count。

要求：

- Langfuse-bound payload 必须遵守 repo 脱敏边界。
- Langfuse-bound payload 不得包含 raw prompt、raw answer、raw transcript、standalone
  query 明文、retrieved snippet、source body 或 provider raw response。
- Langfuse 是 trace / eval sink，不是 conversation truth。
- trace identity 必须能回链到 request / run / workflow / message identity。

### FR10. Eval 与 Dataset

新增或扩展 eval，覆盖多轮上下文质量。

必须包含：

- 指代消解 eval。
- previous evidence reuse eval。
- RAG follow-up recall / precision eval。
- groundedness / hallucination eval。
- context pollution eval。
- latency / token cost eval。
- concurrent turn ordering eval。
- run context envelope fixture eval。

要求：

- Langfuse 作为 dataset、experiment、score 展示和 review 平台。
- repo-owned fixtures、scorer、threshold 和 verdict 仍由 `packages/evals` 拥有。
- 每个 eval run 必须带 run identity、dataset version、variant id 和 source git head。
- score publish 必须能关联 trace 或 dataset run item。

## 10. Canonical Example

### 10.1 输入场景

上一轮：

```text
user: 转专业条件是什么？
assistant: 转专业通常需要满足成绩、名额、学院审核等条件...
```

上一轮 answer 由 `knowledge` capability 完成，并产生 source card：

```json
{
  "type": "source_items",
  "sourceItems": [
    {
      "sourceId": "regulations/student_rules/transfer-major/v2026",
      "title": "本科生转专业管理办法",
      "sectionTitle": "申请条件",
      "sourceKind": "regulation",
      "collection": "regulations/student_rules",
      "collectionLabel": "学生管理制度",
      "versionId": "rule-transfer-major-2026",
      "snippet": "学生申请转专业应符合学校规定的年级、成绩、名额及学院审核要求。"
    }
  ]
}
```

本轮：

```text
user: 那大一能不能申请？
```

### 10.2 Golden Run Context Envelope

该样例表达目标 execution payload projection。`context.conversation` 是实现阶段需要冻结的
wire 位置；`snippet` 可进入模型可见上下文，但不得作为 Langfuse trace 明文字段。

```json
{
  "context": {
    "memory": {
      "enabled": true
    },
    "conversation": {
      "schema_version": "conversation_context.v1",
      "conversation_id": "conv_transfer_001",
      "user_message_id": "msg_user_003",
      "parent_message_id": "msg_assistant_002",
      "current_user_message": {
        "role": "user",
        "content": "那大一能不能申请？"
      },
      "recent_turns": [
        {
          "role": "user",
          "message_id": "msg_user_001",
          "content": "转专业条件是什么？",
          "created_at": "2026-06-21T00:00:00Z"
        },
        {
          "role": "assistant",
          "message_id": "msg_assistant_002",
          "summary": "上一轮回答的是转专业申请条件。",
          "created_at": "2026-06-21T00:00:08Z"
        }
      ],
      "previous_answer_summary": "上一轮围绕转专业申请条件回答，核心证据来自学生管理制度。",
      "previous_evidence_refs": [
        {
          "evidence_id": "ev_transfer_rule_01",
          "source_id": "regulations/student_rules/transfer-major/v2026",
          "document_id": "transfer-major-policy",
          "version_id": "rule-transfer-major-2026",
          "snapshot_id": "student-rules-current-2026-06-21",
          "content_hash": "sha256:transfer-major-evidence-example",
          "source_kind": "regulation",
          "collection": "regulations/student_rules",
          "evidence_role": "condition",
          "access_scope": "public_student_rule",
          "title": "本科生转专业管理办法",
          "section_title": "申请条件",
          "snippet": "学生申请转专业应符合学校规定的年级、成绩、名额及学院审核要求。"
        }
      ],
      "previous_capability_results": [
        {
          "request_id": "req_prev",
          "selected_capability": "knowledge",
          "result_ref": "runtime://results/req_prev/final"
        }
      ],
      "session_state": {
        "confirmed_slots": [],
        "selected_notice_ref": null,
        "turn_count": 2
      },
      "visibility": {
        "model_visible": [
          "current_user_message",
          "recent_turns",
          "previous_answer_summary",
          "previous_evidence_refs",
          "session_state"
        ],
        "runtime_only": [
          "conversation_id",
          "user_message_id",
          "parent_message_id",
          "budget",
          "truncation"
        ]
      },
      "memory_recall": {
        "gate_field": "context.memory.enabled",
        "owner": "execution-control",
        "runtime": "hindsight"
      },
      "source_attribution": [
        {
          "item": "previous_evidence_refs[0]",
          "source": "runtime step/result projection",
          "model_visible": true
        }
      ],
      "budget": {
        "token_estimate": 320,
        "recent_turn_limit": 6
      },
      "truncation": null
    }
  }
}
```

对应 Langfuse-bound trace 只允许记录脱敏摘要。下列 key 是示例性
semantic-to-attribute projection，不是字段名契约；具体 Langfuse attribute name 由
`docs/contracts/langfuse-runtime-observability-contract.md` 冻结。

```json
{
  "envelope_schema_version": "conversation_context.v1",
  "recent_turn_count": 2,
  "previous_evidence_count": 1,
  "model_visible_item_count": 5,
  "runtime_only_item_count": 5,
  "query_rewrite_hash": "sha256:rewrite-example",
  "query_rewrite_resolution_state": "resolved",
  "followup_reference_type": "previous_evidence",
  "previous_evidence_reused": true
}
```

### 10.3 Expected RAG Rewrite

```json
{
  "standalone_query": "大一学生是否可以申请转专业？适用的转专业申请年级和条件是什么？",
  "standalone_query_hash": "sha256:rewrite-example",
  "retrieval_intent": "resolve_followup_against_previous_transfer_major_evidence",
  "resolution_state": "resolved",
  "ambiguity_reason": null,
  "followup_reference": {
    "type": "previous_evidence",
    "ids": ["ev_transfer_rule_01"]
  },
  "requires_new_retrieval": true
}
```

`standalone_query` 只用于 retrieval runtime / repo-owned sanitized eval fixture；Langfuse
trace 只能记录 `standalone_query_hash`、公开 fixture case id 或 categorical state。

## 11. 验收标准

上线前必须满足：

- 固定测试集中的“这个 / 那个 / 上一条 / 第二点”追问通过。
- golden run context envelope fixture 可由 app-api context compiler 稳定生成。
- primary agent trace 中可看到 envelope schema / version semantic summary 或等价 sanitized
  observation。
- RAG trace 中可看到 query rewrite hash、resolution state、followup reference 和 previous
  evidence decision，且不包含 standalone query 明文、retrieved snippet 或 source body。
- P0 fixture 覆盖 budget、visibility、source attribution 与 truncation reason。
- app-api-generated `context.conversation` fixture 不包含 Hindsight recall result。
- final model input budget fixture 覆盖 memory recall completed 与 skipped 两种情况。
- 同一 conversation 连续两条消息不会互相覆盖 active state。
- 超过 token budget 时有明确 truncation reason。
- Langfuse 能按 dataset run 产出 retrieval、groundedness 和 follow-up scores。
- 新增 contract 有 schema / validator / malformed fixture 测试。
- malformed fixture 覆盖 top-level `conversation_context` 被拒绝、缺 provenance、
  memory gate 缺失 / false 的 skipped diagnostics 与 Langfuse forbidden payload。
- 至少一条 integration smoke 覆盖多轮追问进入 RAG 的完整路径。
- 至少一条 non-RAG / direct answer smoke 覆盖 envelope 进入 primary agent 的路径。

## 12. 分期

### P0. Run Context Envelope 进入主链路

- 定义 `context.conversation` contract。
- app-api 装配 current user message、recent turns、previous answer summary、previous
  evidence proof refs、previous capability result refs、session state、visibility、budget
  与 truncation summary。
- execution-control 接收、strict decode 并校验 `context.conversation`。
- primary agent 注入 recent turns、previous answer summary、previous evidence refs、
  execution-control enrichment 的 memory recall output 与 session state。
- Langfuse trace 记录 context assembler 脱敏摘要。
- 不承诺完整 RAG rewrite 效果闭环、不承诺 complete regenerate branch UI。

### P1. RAG 追问闭环

- RAG query rewrite 使用 recent turns 和 previous evidence refs。
- query rewrite 输出 `resolution_state`、`ambiguity_reason` 与 follow-up reference。
- RAG synthesis 支持 previous evidence reuse。
- 增加 follow-up reference trace 与 standalone query hash。
- 增加多轮 RAG eval fixtures 和 deterministic scorer。

### P2. 并发、分支与上下文摘要硬化

- turn sequence guard。
- regenerate branch schema / active branch pointer。
- compact / summary strategy。
- context summary 预留字段接入。
- late completion / cancel / timeout 状态保护。

### P3. Langfuse Eval 产品化

- dataset sync。
- experiment runner。
- score publish。
- review queue / annotation 回流。
- operator-safe eval backlink projection。

## 13. 成功指标

- 多轮追问准确率提升。
- RAG follow-up recall 提升。
- previous evidence reuse 命中率可解释。
- 无依据回答率下降。
- 单轮平均 latency 增幅可控。
- token 成本增幅可解释。
- trace 能复现每一次上下文装配和裁剪决策。

## 14. 风险与约束

- 带入历史会增加 token 成本和 latency，必须通过 budget 和 eval 控制。
- 历史上下文可能污染当前问题，必须通过 priority 和 source attribution 控制。
- previous evidence 复用可能引用过期材料，必须检查 source / version / access。
- 并发 turn 会放大状态覆盖风险，必须用 message/run binding 和 sequence guard 控制。
- Langfuse 只能作为 observability / eval sink，不能成为请求或对话状态真相。
- Langfuse 不得记录 raw query、retrieved snippet、source body 或 provider raw response。
- 如果 previous evidence 只能从 raw provider response 或 Temporal history 恢复，P0 必须
  降级为 recent turns + answer summary，并先补 sanitized projection contract。

## 15. 文档依赖

- Current merged truth:
  [docs/architecture/current-architecture.md](../architecture/current-architecture.md)
- Execution Agent Layer:
  [docs/architecture/system/execution-agent-layer-architecture.md](../architecture/system/execution-agent-layer-architecture.md)
- Capability execution contract:
  [docs/contracts/capability-execution.md](../contracts/capability-execution.md)
- Memory plane:
  [docs/architecture/system/memory-plane-architecture.md](../architecture/system/memory-plane-architecture.md)
- Retrieval serving:
  [docs/architecture/system/retrieval-serving-architecture.md](../architecture/system/retrieval-serving-architecture.md)
- Langfuse runtime observability contract:
  [docs/contracts/langfuse-runtime-observability-contract.md](../contracts/langfuse-runtime-observability-contract.md)
- Langfuse eval platform:
  [docs/product/langfuse-eval-platform-completion-prd.md](./langfuse-eval-platform-completion-prd.md)
