---
doc_type: architecture
truth_scope: execution
owner_boundary: prompt-runtime
status: active
created: 2026-06-13
updated: 2026-06-13
---

# Prompt And Instruction Assembly And Assets

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## Instruction Hierarchy

repo 级 instruction hierarchy 固定拆成五层：

1. `platform/runtime invariants`

- 来自产品边界、架构边界、安全边界
- 例如当前 `Execution Agent Layer-led orchestration`、`capability contract`、
  `source truth and capability opening gate`

1. `role instructions`

- 某个 package / agent 的长期职责与禁止事项
- 稳定、低频变更

1. `task packet`

- 某次请求的 mode、目标、上下文、允许动作、禁止动作、输出 schema
- 高频变更

1. `evidence packet`

- retrieval / operator / external observation 的结构化输入
- 明确标为 untrusted content

1. `post-LLM contract`

## Product-Path Runtime Assembly

当前 product-path runtime assembly 固定遵循以下顺序：

1. `repo-global developer invariants`
1. `package-owned role prompt`
1. `trusted task packet`
1. `untrusted user input`
1. `untrusted evidence packet`
1. `strict structured output contract`
1. `code-side finalization`

当前实现边界：

- `apps/execution-control`
  - owns execution admission, first decision activity scheduling, prompt config
    admission summary, deterministic terminal envelopes and sanitized
    finalization/projection
  - resolves active prompt provider profiles from `apps/app-api` internal
    provider-config APIs for `primary_agent` and `rag_synthesis`
- `apps/agent-runtime`
  - owns primary agent SDK instructions, model-visible strict tool schemas,
    tool-call loop, direct/no-tool final output and SDK trace normalization
  - consumes request-scoped `provider_config` from execution-control; it does
    not select provider/model/API key from env for online serving
- `packages/prompt-runtime`
  - owns provider-facing prompt contract validation, structured output execution,
    provider response normalization and prompt trace construction for
    knowledge/RAG synthesis and other explicit provider activities
- Go-owned knowledge / RAG runtime
  - owns rag role prompt assets、typed task packet 与 typed evidence packet
- `apps/app-api`
  - owns encrypted provider-config profiles and operator mutation APIs
  - exposes internal active runtime snapshots to execution-control
  - 只消费 observability-safe prompt metadata，不参与 prompt assembly

补充约束：

- `apps/app-api` 不选择 `product persona` 或 `surface prompt profile`；它只投影
  surface/session/account context 与 allowed capability/tool set
- `system prompt` 在产品语义上必须影响第一模型决策；当前实现 owner 是
  `apps/agent-runtime` primary agent instructions，而不是 browser surface 或
  app-api route handler
- `assistant_intro` / `product_meta` 不作为 prompt family 或 capability；产品身份、
  能力边界、普通寒暄由 first Execution Agent decision 的 direct/no-tool
  terminal branch 处理

禁止事项：

- 不把 user text 拼进 developer message
- 不把 retrieval snippets 拼进 developer message
- 不让 app-local route handler 直接拼自己的 prompt 文本绕过 package-owned registry
- 不让 provider 自由文本输出绕过 schema / post-LLM contract 校验
- schema validation、policy finalization、citation checks、deny-path shaping
- 永远回到 code 层执行

结论：

- 不存在“一份 prompt 就是系统真相”
- repo 真相始终是 `docs/architecture` + `docs/decisions` + code contracts

## Repo-Global System Prompt Blueprint

当前 repo 的长期正确形态不是一份覆盖所有 agent、mode 与 data-plane 的 monolithic mega prompt。

repo 级只应保留一段极薄、极稳定的 global invariants；其余内容继续拆到 package-owned prompt family 与
typed packet。

推荐的 repo-global system block 只包含以下语义：

- 你属于一个 `institution-scoped campus assistant`
- 你不得改写 policy / serving-surface / capability-opening / scope truth
- 你不得用开放域世界知识补齐 institution-specific 缺口
- 如果请求是 `unsupported`、`ambiguous`、`not opened` 或 `not grounded by evidence`，必须
  abstain 或要求澄清
- 输出必须满足 typed schema，并接受 code-side finalization

可直接复用的参考 block 应保持在这个量级：

```text
You are an institution-scoped campus assistant.
Never override policy, capability-opening, serving-surface, or scope truth supplied
by code and typed packets.
Never use open-world knowledge to fill institution-specific gaps.
If the request is ambiguous, not opened, unsupported, or not grounded by
evidence, abstain or ask for clarification.
Return only schema-compliant output. Code-side finalization is authoritative.
```

这段 block 的职责只有：

- 固定 repo 级产品姿态
- 固定 “prompt 不是边界” 的长期规则
- 防止 package-local prompt family 漂移成各自的私有产品定义

它不负责：

- routing
- capability opening
- query-enabled surface 判定
- retrieval planning
- answer finalization
- claim-level grounding judgement

这些仍然必须留在 code side。

## Final Runtime Shape

当产品方说“system prompt”时，repo 内允许把它当作一个便于沟通的简称。

但长期实现真相固定为：

`repo-global developer invariants -> package-owned role developer prompt ->
typed trusted task packet -> typed untrusted evidence/user packet -> strict
structured output + code-side finalization`

补充约束：

- 对 OpenAI-compatible runtime，repo-global 那一层应优先实现为 `developer message`，而不是继续膨胀成
  monolithic mega system prompt
- `system prompt` 这个词只保留为产品沟通 shorthand，不得反向诱导实现把 role、task、evidence、schema
  全堆回单块字符串
- user text、retrieved snippets、external observations、free-text memory 一律视为
  `untrusted content`，不得进入 developer / trusted instruction zone
- package-owned role prompt 可以继续使用 markdown template 资产，但进入 provider runtime
  时必须按 trusted / untrusted zone 显式拼装
- product-path 最终必须能稳定落下
  `prompt_id`、`prompt_version`、`template_sha256`、`model_provider`、`model_name`

因此，repo 最终不追求：

- 一份更长的总 system prompt
- 把 routing / capability-opening / serving truth 写成 prompt 文案
- 把 prompt 当作 agent graph 的唯一真相源

repo 最终追求的是：

- 一个极薄、稳定、可版本化的 repo-global invariants block
- 按 execution / agent / mode 拆分的 package-owned prompt family
- 明确的 trusted task packet 与 untrusted evidence packet 分区
- strict structured outputs、grounding validator 与 code-owned finalization

## Package-Owned Prompt Shape

repo 当前推荐的 system / role 设计固定为：

1. `repo-global invariants`
1. `package-owned role prompt`
1. `typed task packet`
1. `typed evidence packet`
1. `post-LLM contract`

直接含义：

- knowledge runtime 的 prompt family 只负责 `answer / clarify /
  no-answer / unsupported` 的 grounded wording
- Python worker 当前不拥有 production execution terminal prompt family；
  non-delegate terminal routing 由 Go direct terminal path 返回，Go 继续负责
  delegated agent response finalization
- retrieval runtime seam 不拥有 top-level system prompt
- `apps/*` 不拥有 execution prompt truth，只负责 request packaging / runtime admission
  / product projection

## Current Prompt Template Shape

当前 repo 应继续保持最小模板结构：

- `<role>`
- `<invariants>`
- `<task>`
- `<output_contract>`

如果需要 packet 注入，再额外显式拆为：

- `<trusted_task_packet>`
- `<untrusted_evidence_packet>`

固定规则：

- trusted packet 只放 typed fields 与 safe summaries
- untrusted packet 只放 retrieval snippets / external text / user free text
- untrusted packet 不得伪装成 instructions 口吻
- system / role prompt 不得因为 snippet 内容而发生 priority inversion

## Ownership

### `apps/app-api`

- 不拥有 execution prompt 真相
- 只拥有 product-layer session / principal / request context projection
- 可拥有 consumer-facing UX copy prompt，但不拥有 agent instructions

### Execution Runtime Prompt Boundary

- 不拥有长期 prompt 文案
- 只负责 execution admission、transport、request packaging 与 first decision frame
- owns deterministic execution terminal wording
- owns runtime policy / routing frame / handoff projection
- 不拥有 retrieval evidence ranking 和 collection-specific answer synthesis

### Knowledge Runtime

- owns knowledge-path / `knowledge` role instructions
- owns answer / clarify / no-answer / unsupported prompt families
- owns evidence-to-answer prompt packet assembly
- 不拥有 account truth、operator access truth、serving truth 或 capability-opening truth

### Retrieval Runtime

- 不拥有 top-level task prompt
- 只拥有 evidence retrieval 与 safe evidence serialization helper

## Prompt Family Model

每个 agent 不维护一份“大 prompt”，而维护 `prompt family + mode`。

当前 production execution terminal path 不维护独立 synthetic prompt family。
`apps/agent-runtime` primary agent 可以产生 direct/no-tool terminal answer、
`clarification_required`、`out_of_scope` 与 `unsupported_by_evidence` 等 terminal
reason；Go `execution-control` 负责把它们 finalization 为 product-safe response 和
sanitized projection。该路径必须复用 repo-global invariants、execution role
instructions、typed task packet 与 strict tool/output contract，不得新增
`assistant_intro` 或 product-persona prompt family。若后续重新引入更复杂的
LLM-assisted execution wording，必须作为新的显式 workstream 重新定义 prompt family、
eval gate 与 code finalization，不得复用已删除的旧 execution prompt assets。

### Knowledge Path

- `rag_answer_v1`
- `rag_clarify_v1`
- `rag_no_answer_v1`
- `rag_unsupported_v1`

可选后续 family：

- `rag_rewrite_v1`
- `rag_compare_answer_v1`
- `rag_historical_answer_v1`

## Prompt Asset Placement

prompt assets 长期放在各自 owner source tree 内，而不是集中堆到 repo root。当前
knowledge/RAG prompt assets 由 Go-owned execution path 与 `packages/prompt-runtime`
contract 管理；旧 Python `packages/knowledge-capability` prompt tree 已从 active workspace
删除。

prompt-facing vocabulary 规则固定为：

- package path / `runtime_target` metadata 继续可以保留在 owner metadata 与代码装配面
- model-facing `<role>` 文案默认使用 capability wording 或 forward family label
- 不把 `knowledge` / `navigation` 这类 raw capability id 当作默认 prompt persona
  名称

每个 prompt family 至少包含：

- `prompt_id`
- `version`
- `owner_package`
- `runtime_target`
- `capability_family`
- `supported_modes`
- `variables_schema_version`
- `output_schema_version`
- `template_sha256`
- `eval_suite`
