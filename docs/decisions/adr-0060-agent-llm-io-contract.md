---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0060
status: accepted
created: 2026-06-19
updated: 2026-07-13
---
# ADR-0060 Agent LLM I/O Contract

## 状态

Accepted on 2026-06-19.

## 背景

`campus-agent` 已经在 prompt / instruction architecture 中接受：

- prompt 不是 policy、serving surface、tool opening 或 source-trust 边界
- `system prompt` 只是产品沟通 shorthand，不是实现上的 monolithic mega prompt
- product path 应按 developer invariants、role prompt、typed task packet、
  untrusted evidence / user packet、strict structured output 与 code-side
  finalization 装配

近期在线链路审查确认，现有原则已经落在文档中，但仍缺少一条 ADR 把
agent-facing LLM input / output contract 冻结下来。这里的 contract 指运行时
给模型的 developer instructions、tool schemas、typed input packet 与
strict structured output，而不是 prompt 治理产品。

否则后续实现容易继续把问题误解成“补一份更长的 system prompt”或“新增
prompt registry / versioning”，而不是修复具体 LLM I/O contract：

- `apps/agent-runtime` 必须让 primary 与 Knowledge Agent 共用严格 terminal
  contract，而不是让 handoff 产生另一套自由文本结果
- Knowledge Agent 的 evidence-backed output 必须显式表达 answer、outcome 与
  evidence refs；execution-control 不能通过第二次模型调用补齐
- provider `refusal`、`incomplete`、schema failure 与 invalid structured payload 必须
  fail-close，不能靠消费层默认补齐 semantic outcome 或 confidence

OpenAI 当前官方实践也支持这个方向：

- reasoning models 应使用简短直接的 developer messages，避免 chain-of-thought prompt，
  并用 delimiter 区分输入区块
- GPT-5 系列可靠性来自 Responses API、reasoning controls、verbosity、structured
  outputs、tool design、state management 等组合，而不是只靠 prompt 文案
- Structured Outputs 应承接输出 schema validation；不要只在 prompt 里自然语言描述 schema
- tool-specific guidance 应优先放在 tool description 中；只有跨工具 policy 才进入
  developer instructions
- Structured Outputs 仍可能遇到 refusal、incomplete 或 token limit；应用必须检查并 fail-close

## 决策

`campus-agent` 接受以下 Agent LLM I/O contract：

```text
thin developer instructions
+ explicit tool/function schemas
+ typed task packet
+ untrusted user/evidence packet
+ strict structured outputs
+ code-side guardrails/finalization
```

本 ADR 不接受“更长的总 system prompt”、prompt versioning 或 prompt admin UI
作为主链路修复方向。

## 决策细节

### 决策 1：developer instructions 保持薄且稳定

repo-global developer instructions 只表达长期不变量：

- institution-scoped campus assistant
- 不覆盖 policy、tool opening、serving surface、scope 或 source-truth
- 不用开放域知识补齐 institution-specific 缺口
- 请求 ambiguous、unsupported、not opened 或 not grounded 时必须 abstain 或要求澄清
- 输出必须满足 typed schema，code-side finalization authoritative

它不承接：

- tool selection protocol
- `knowledge_search` scope/version or tool-argument details
- answer citation rules的字段全集
- tool opening 或 source-trust 判断
- provider schema 描述
- prompt registry / prompt version governance

### 决策 2：tool guidance 优先进入 tool description 与 schema

模型可见 tool 必须以 structured tool / function schema 暴露。

tool description 应说明：

- tool 做什么
- 什么时候使用
- required input
- read/write side effect
- retry / cancellation safety
- common fail-close modes

developer instructions 只保留跨工具 policy，不复制每个 tool 的领域细节。

### 决策 3：direct/no-tool final output 也必须有 typed terminal contract

primary agent 的 direct/no-tool branch 不得只返回自由文本。模型可以直接回答
`hi 你是谁`，但返回给 runtime 的终态必须是 typed terminal envelope；这不是
把寒暄拆成 tool / tool。

目标 terminal envelope 至少区分：

- `answer`
- `clarification_required`
- `out_of_scope`
- `unsupported_by_evidence`
- `policy_refusal`

Go finalization 可以校验这些语义并映射 product response status、sources 与
observability projection，但不得改写 answer text，或靠空字符串、默认 confidence
猜测 terminal outcome。

### 决策 4：Knowledge Agent schema 必须表达 answer 和 evidence 语义

Knowledge Agent 不负责重新打开 scope、放宽 source-trust 或绕过 internal
`knowledge_search`。

Knowledge Agent structured output 至少应表达：

- `answer_text`
- `semantic_outcome`
- `confidence`
- `used_evidence_refs`
- `grounding_notes` 或等价 bounded diagnostic

`semantic_outcome`、`confidence` 与 grounding refs 不得由消费层静默默认成成功值。

### 决策 5：untrusted content 不进入 trusted instruction zone

以下内容一律作为 untrusted packet：

- user free text
- retrieved snippets
- external observations
- free-text memory
- tool output body

它们不得拼进 developer message 或 role instructions。

当前实现使用 `final_model_context.v2` 和 OpenAI Agents SDK
`AgentInputItem[]`：历史 user/assistant turns 保留角色；session state、previous
evidence/tool result 与 personal memory 作为明确标注的 context data items；当前用户
消息作为最后一个 user item 只出现一次。Knowledge Agent 的 admitted target ids/
descriptions 是 runtime-owned instructions，handoff query 不拼入 instructions。

### 决策 6：provider refusal / incomplete / schema failure fail-close

Responses API 或 SDK 返回以下状态时，prompt consumer 必须 fail-close：

- provider HTTP failure
- provider response status is not completed
- refusal / content-filter style refusal
- incomplete / max-output-token exhaustion
- missing structured payload
- structured payload fails schema validation
- output references evidence not selected by the code-owned evidence packet

fail-close 结果必须进入 sanitized projection；不得伪装成 empty answer、medium
confidence 或 generic no-answer。

### 决策 7：运行边界由 typed runtime limits 控制

Execution-control 必须在每次 Agent Activity 请求中提供 SDK deadline、maximum
turns、maximum output tokens、maximum knowledge searches、current input character
limit 与 prior context character limit。Agent-runtime 不从 request-scoped env 或隐式
默认值推断这些边界。

Runtime terminal error 使用稳定 code：`context_budget_exceeded`、
`agent_deadline_exceeded`、`max_turns_exceeded`、`provider_unavailable`、
`tool_execution_failed`、`run_failed`。JSON 与 SSE 终态使用同一 shape；Temporal 已经
拥有 Activity retry 语义，因此返回 execution-control 的终态错误标记为
non-retryable。

## 结果

当前 online contract 覆盖 primary direct outcome、official Knowledge Agent
handoff、SDK function tools、`final_model_context.v2` structured SDK input 与同一
terminal envelope。Execution-control 执行字符预算、schema/evidence/source
validation 和 deterministic projection，不在 prompt 中重建动态上下文。

## 不决定

本 ADR 不决定：

- 新增 prompt versioning / prompt registry / prompt admin UI
- 把所有 prompt 迁移到 OpenAI hosted prompt template
- 让 app-api 或 browser surface 拥有 prompt assembly
- 用 prompt 替代 tool admission、serving surface、source-trust 或 finalization
- 任何 eval 平台或 release gate 的上线要求

## 相关文档

- `docs/architecture/system/prompt.md`
- `docs/architecture/system/agent-framework.md`
- `docs/architecture/system/tool-runtime.md`
- `docs/architecture/system/execution-agent-layer.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/architecture/system/tool-routing.md`
- `docs/decisions/adr-0048-temporal.md`

## 外部参考

- OpenAI Reasoning best practices:
  `https://developers.openai.com/api/docs/guides/reasoning-best-practices#how-to-prompt-reasoning-models-effectively`
- OpenAI latest model guidance:
  `https://developers.openai.com/api/docs/guides/latest-model#using-reasoning-models`
- OpenAI Function calling:
  `https://developers.openai.com/api/docs/guides/function-calling#how-it-works`
- OpenAI Structured Outputs:
  `https://developers.openai.com/api/docs/guides/structured-outputs#tips-for-your-json-schema`
