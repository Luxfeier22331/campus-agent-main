---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0060
status: accepted
created: 2026-06-19
updated: 2026-06-19
---
# ADR-0060 Agent LLM I/O Contract

## 状态

Accepted on 2026-06-19.

## 背景

`campus-agent` 已经在 prompt / instruction architecture 中接受：

- prompt 不是 policy、serving surface、capability opening 或 source-trust 边界
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

- `apps/agent-runtime` primary agent instructions 较薄，且 direct/no-tool final output
  仍是自由文本终态
- Go-owned RAG synthesis 已使用 Responses API structured output，但当前 schema 只要求
  `answer_text`，语义 outcome、confidence 与 grounding refs 仍未成为 provider output
  contract
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
- 不覆盖 policy、capability opening、serving surface、scope 或 source-truth
- 不用开放域知识补齐 institution-specific 缺口
- 请求 ambiguous、unsupported、not opened 或 not grounded 时必须 abstain 或要求澄清
- 输出必须满足 typed schema，code-side finalization authoritative

它不承接：

- tool selection protocol
- retrieval planning details
- answer citation rules的字段全集
- capability opening 或 source-trust 判断
- provider schema 描述
- prompt registry / prompt version governance

### 决策 2：tool guidance 优先进入 tool description 与 schema

模型可见 capability 必须以 structured tool / function schema 暴露。

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
把寒暄拆成 tool / capability。

目标 terminal envelope 至少区分：

- `answer`
- `clarification_required`
- `out_of_scope`
- `unsupported_by_evidence`
- `policy_refusal`

Go finalization 可以把这些语义映射成 product response status、用户可见文案
与 observability projection，但不得靠空字符串、默认 confidence 或自由文本猜测
terminal outcome。

### 决策 4：RAG synthesis schema 必须表达 answer 和 grounding 语义

RAG synthesis prompt 不负责重新打开 scope、放宽 source-trust 或执行 retrieval planning。

RAG synthesis structured output 至少应表达：

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

## 结果

当前在线实现的优先补齐顺序固定为：

1. `apps/agent-runtime` primary agent direct/no-tool terminal envelope。
2. Go-owned RAG synthesis structured output schema and fail-close parser。
3. tool descriptions and model-visible schema audit。
4. offline ingestion prompt consumers 的 confidence / semantic default cleanup。

这些是实现缺口，不是新增 prompt governance 产品。

## 不决定

本 ADR 不决定：

- 新增 prompt versioning / prompt registry / prompt admin UI
- 把所有 prompt 迁移到 OpenAI hosted prompt template
- 把 RAG synthesis 迁移到 Agents SDK
- 让 app-api 或 browser surface 拥有 prompt assembly
- 用 prompt 替代 capability admission、serving surface、source-trust 或 finalization
- 任何 eval 平台或 release gate 的上线要求

## 相关文档

- `docs/architecture/system/prompt-and-instruction/assembly-and-assets.md`
- `docs/architecture/system/prompt-and-instruction/current-runtime-baseline.md`
- `docs/architecture/system/prompt-and-instruction/safety-observability-and-rollout.md`
- `docs/architecture/system/agent-framework-boundary-architecture.md`
- `docs/architecture/system/tool-and-capability-runtime-architecture.md`
- `docs/architecture/system/execution-agent-layer-architecture.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`
- `docs/decisions/adr-0048-temporal-execution-plane.md`

## 外部参考

- OpenAI Reasoning best practices:
  `https://developers.openai.com/api/docs/guides/reasoning-best-practices#how-to-prompt-reasoning-models-effectively`
- OpenAI latest model guidance:
  `https://developers.openai.com/api/docs/guides/latest-model#using-reasoning-models`
- OpenAI Function calling:
  `https://developers.openai.com/api/docs/guides/function-calling#how-it-works`
- OpenAI Structured Outputs:
  `https://developers.openai.com/api/docs/guides/structured-outputs#tips-for-your-json-schema`
