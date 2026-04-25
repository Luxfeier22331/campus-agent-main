---
doc_type: architecture
status: active
created: 2026-04-05
updated: 2026-04-25
---
# Prompt And Instruction Architecture

## 文档边界

本文冻结 `campus-agent` 的 prompt / instruction supporting architecture。

它回答的是：

- supervisor-led execution path 应该如何分层设计 system / developer / task instructions
- 哪些内容必须继续由代码拥有，哪些内容适合交给 prompt
- prompt assets 在 repo 中由谁拥有、如何版本化、如何进入 eval / release gate
- retrieval evidence、personalization、observability 与 prompt 之间的边界如何固定

它不负责：

- 某个 vendor SDK 的具体调用方式
- 某个模型版本的最终选型
- 某次迭代的具体 prompt 文案
- retrieval / authz / serving truth 的产品级决策

## 当前接受的实现基线

当前 repo 已经把 prompt / instruction runtime 收口为显式 supporting architecture +
code-owned runtime seam。当前接受的实现基线是：

- Go `apps/supervisor-api` 拥有 intent framing、routing、policy 与 response
  finalization
- `packages/rag-agent` 拥有 ambiguity handling、query planning、retrieval-oriented
  answer shaping
- `packages/retrieval-core` 拥有 evidence retrieval kernel

补充约束：

- repo-global developer invariants 由 shared prompt runtime helper 持有
- package-owned role prompt 当前由 `packages/rag-agent` prompt registry 持有；
  Python production supervisor terminal prompt family 已移除
- `packages/rag-agent` 的 runtime package 名称继续保持 current merged truth；但
  prompt-facing persona / family wording 应使用 `rag-agent` 或中性的 knowledge-path
  wording，不再把 `rag-agent` 当默认对外标签
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/prompt_stack.py`
  负责把 developer invariants、role prompt、trusted task packet、untrusted user/evidence
  packet 组装成 runtime stack
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/prompt_executor.py`
  负责 provider-backed strict structured outputs，并在产品主链路生成 validated
  `PromptTrace`
- provider `refusal`、`incomplete` 与 request/schema failure 必须在 RAG prompt execution
  path fail-close，不得被当作 schema-valid success 放行
- `apps/app-api`、operator observability 与 eval runtime 统一投影 `prompt_id`、`prompt_
  version`、`template_sha256`、`prompt_runtime_state`、`prompt_runtime_detail`
- curriculum / handbook 的 deterministic-first protected paths 继续保持
  deterministic-first，不因 prompt rollout 回退成 prompt-first
- 当前 phase 顺序、剩余 rollout 与 pending work 不在本文维护；应以
  `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md` 为准
- full agentic retrieval 的长期 target shape 另见
  `docs/architecture/system/agentic-retrieval-architecture.md`

## Agentic Retrieval Prompt Families

如果长期推进到 full agentic RAG，prompt family 继续固定拆成：

- `planner prompt`
  - 只负责输出 typed retrieval plan 或 bounded replan decision
- `clarification / no-answer prompt`
  - 只负责在既有 gate 语义下生成用户可见表达
- `synthesis prompt`
  - 只负责基于 supporting evidence 生成回答
- `grounding validation prompt`
  - 只负责检查 synthesis 输出是否仍被 evidence 支持

固定规则：

- `retrieval-core` 不拥有 top-level planner prompt
- planner prompt 不得直接返回最终用户答案
- synthesis prompt 不得绕过 plan / executor / supporting evidence selection

## Planner Structured Output Boundary

长期 planner prompt 只能输出 strict structured plan artifact，而不是自由文本工具描述。

它允许表达：

- resolved query mode
- admitted retrieval steps
- step-local query / filter / target scope
- planner reason summary
- replan / abort decision

它不允许表达：

- 未 admission 的 scope opening
- authz 结论
- source-trust 提权
- unrestricted live/web fallback

## 外部最佳实践对齐（2026-04-12）

本仓库当前 prompt runtime 形态与 OpenAI 官方文档的主线建议一致：

- 新的 text generation app 默认走 Responses API，而不是继续围绕旧 Chat Completions 组织产品主链路
- 应用拥有的高优先级规则放在 `instructions` / `developer` 层，用户输入与 evidence 继续留在低优先级输入区
- untrusted content 不进入 developer instruction zone；节点间数据交换尽量走 strict structured
  outputs，而不是自由文本通道
- prompt / model 变更应绑定持续 eval，而不是只靠人工感受或一次性 smoke

对应官方资料：

- OpenAI Prompting
  - `<https://platform.openai.com/docs/guides/prompting`>
- OpenAI Responses vs Chat Completions
  - `<https://platform.openai.com/docs/guides/responses-vs-chat-completions`>
- OpenAI Structured Outputs
  - `<https://platform.openai.com/docs/guides/structured-outputs`>
- OpenAI Evaluation Best Practices
  - `<https://platform.openai.com/docs/guides/evaluation-best-practices`>

## 核心立场

`campus-agent` 的 prompt 设计固定采用：

`code-first orchestration + prompt-scoped reasoning`

也就是：

- code 负责边界、权限、serving truth、routing gate、deterministic stop condition
- prompt 负责语义判断、澄清文案、证据约束下的答案表达、解释压缩与非确定性 wording

禁止退化为：

- `prompt-first orchestration`
- 用 prompt 软约束代替 authz / serving filter
- 把 retrieval snippets 或 external content 直接拼进 trusted instructions 区
- 用一份 monolithic mega prompt 覆盖所有 agent、所有 mode、所有数据面

## Prompt 不是边界

以下内容长期不得依赖 prompt-only 软约束：

- authz / visibility / entitlement 决策
- current query-enabled scope
- runtime profile / serving alias / release manifest
- fail-close deny path
- restricted document title / snippet 泄漏控制
- irreversible action gate 或 approval gate

这些 truth 继续由：

- `apps/app-api`
- `apps/supervisor-api`
- `packages/retrieval-core`
- registry / runtime profile / release manifest

共同拥有。

## Planner Prompt 不是执行边界

长期 agentic retrieval 下，planner prompt 同样不是边界 owner。

它不能替代：

- runtime profile / serving posture
- authz / visibility enforcement
- freshness gate
- source-trust admission
- candidate set 与 supporting evidence 的分层

planner 只能在这些 code-owned truth 之内生成 plan。

## 长期产品姿态

`campus-agent` 长期保持为 `institution-scoped campus assistant`，不是默认开放域通用助手。

这意味着：

- 不把校外世界知识缺口伪装成“RAG 没召回到”
- 不把超出当前 capability / serving surface 的问题硬塞进现有 campus retrieval path
- 不因为问题带有“政治”或“敏感”字样，就自动当作同一类拒答
- 不在 campus path 内隐式启用 general web / world knowledge fallback

长期默认规则：

- `in-scope + policy-allowed + grounded` 可以回答
- `in-scope + evidence-insufficient` 应 fail-close 为无依据回答
- `out-of-scope` 应显式说明产品边界，而不是伪装成 handbook / curriculum 问题
- `policy-disallowed` 应走明确的 policy refusal，而不是混写成普通 `no_answer`

## 结果语义模型

长期上，repo 不再把“拒答”理解为单一桶，而是固定区分以下语义结果：

- `grounded_answer` 当前问题在产品范围内，且回答可由允许的证据支持
- `needs_clarification` 当前问题可能在范围内，但缺少足够的 disambiguation / slot truth
- `unsupported_by_evidence` 当前问题在范围内，但没有足够依据支持安全作答
- `out_of_scope` 当前问题不属于当前 institution / capability / serving surface 所承接的产品范围
- `policy_refusal` 当前问题触发平台或产品级禁止事项
- `restricted_access_denied` 当前问题相关内容存在，但当前 actor 无权读取
- `approval_required` 当前请求涉及不可直接执行的高风险动作

补充约束：

- transport / runtime status 可以在过渡期继续保持 `completed`、`needs_clarification`、`no_an
  swer`、`rejected`、`approval_required`、`error`
- 但 observability、eval truth、prompt packet 与 operator projection 长期不得再把 `out_of_
  scope`、`unsupported_by_evidence`、`policy_refusal`、`restricted_access_denied`
  混成一个模糊的 `no_answer`
- 如果当前 contract 尚未升级，这些语义至少也要以显式 `semantic_outcome` / `refusal_class` /
  `no_answer_reason` 投影存在

## Policy、Scope 与 Grounding 的分工

长期固定拆成三类判断，不互相替代：

1. `policy gate`

- 判断“能不能处理这类请求”
- 例如明显违规内容、越权高风险请求、targeted political persuasion 或其他产品明令禁止事项

1. `scope gate`

- 判断“这是不是当前产品边界内的问题”
- 例如 “MIT 的校长是谁” 属于 `out_of_scope`，而不是 campus RAG 的普通空召回

1. `grounding gate`

- 判断“即使问题合法且在范围内，当前证据是否足够支持回答”
- 例如培养方案里具体课程、制度条款、办事流程缺乏足够依据时，应进入 `unsupported_by_evidence`

长期禁止：

- 用 retrieval miss 替代 `out_of_scope`
- 用 topic keyword 替代 policy judgement
- 用 prompt-only wording 掩盖 policy / scope / grounding 的实际差异

## Replan And Abort Semantics

长期 agentic retrieval 可以存在 bounded replan，但它不是无限重试。

固定规则：

- replan 必须显式记录原因
- replan 次数必须受 budget 约束
- planner 无法产出 admitted plan 时直接 fail-close
- 不能因为第一次召回不理想，就隐式放宽 scope / authz / freshness 约束

## 敏感主题处理规则

长期上，“政治敏感”不是一个足够精确的实现分类。

固定规则如下：

- 话题本身带有政治色彩，不等于必须拒答
- 如果问题属于校园产品范围，且可由当前开放证据支持，应正常回答
- 如果问题不在校园产品范围内，应走 `out_of_scope`
- 如果问题触发平台或产品禁止事项，应走 `policy_refusal`

因此：

- “习概有哪些专业要上” 属于 campus curriculum / course truth，若证据充分，应回答
- “MIT 的校长是谁” 属于 `out_of_scope`
- 面向特定人群的政治操纵、定向说服或其他明确违规请求 属于 `policy_refusal`

## 幻觉控制姿态

长期上，repo 对幻觉的控制固定采用：

`bounded scope + structured evidence + grounded generation + abstain when
unsupported`

具体约束：

- 不允许模型在 evidence 不足时用世界知识或常识自动补齐 institution truth
- 不允许 agent 因为没有识别到 campus signal，就默认把问题回退成某个现有 collection 的普通问句
- citation-expected 的回答必须能回链到 explicit evidence bundle
- high-structure deterministic answer path 继续优先于 prompt-only freeform synthesis
- live / remote retrieval output 继续视为 untrusted evidence payload，不得进入 developer
  instruction zone
- raw candidate trace 不得直接当作 synthesis prompt 的 answer-bearing evidence 输入

## 幻觉分类模型

当前 repo 不把 hallucination 简化成“答错了一个事实”。

至少固定区分以下五类：

1. `scope hallucination`

- 把域外问题伪装成校园范围内问题

1. `policy hallucination`

- 在证据不足时编造制度、流程、限制或授权条件

1. `citation hallucination`

- 回答看起来有依据，但关键 claim 实际没有被 evidence bundle 支持

1. `freshness hallucination`

- 对 freshness-sensitive 问题假装自己掌握最新状态

1. `authorization hallucination`

- 用未授权或隐藏内容补答案，或泄漏 restricted title / snippet

repo 的 hallucination control 必须分别针对这五类做 gate，而不是统一归类成“prompt 质量问题”。

## 所有权划分

### `apps/app-api` ownership

- 拥有 product-facing answer kind 映射与 operator-facing projection
- 不拥有 policy / scope / grounding 的最终真相判断

### `apps/supervisor-api` ownership

- 拥有 top-level `policy gate` 与 `scope gate`
- 拥有语义终态 finalization
- 长期上应区分 `policy_refusal`、`out_of_scope` 与普通 `needs_clarification`

### `packages/rag-agent` ownership

- 只处理已进入 in-scope knowledge path 的问题
- 拥有 ambiguity handling、retrieval planning、grounded answer
  synthesis、`unsupported_by_evidence`
- 不应承担通用 off-domain classification
- 不应把明显域外问题伪装成 handbook / curriculum 空召回

### `packages/retrieval-core` ownership

- 只拥有 retrieval / evidence shaping / authz filter execution
- 不拥有 top-level policy refusal 或 product scope judgement

### prompt family

- 只负责对应语义结果的 wording
- 不拥有 policy / scope / grounding truth
- 不得把“答不出来”的原因从结构化 verdict 退化回自由文本猜测

## Instruction Hierarchy

repo 级 instruction hierarchy 固定拆成五层：

1. `platform/runtime invariants`

- 来自产品边界、架构边界、安全边界
- 例如当前 `supervisor-led orchestration`、`agent contract`、`restricted deny no leak`

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

- `apps/supervisor-api`
  - owns prompt config admission summary and deterministic terminal envelopes
- `apps/supervisor-agent-worker`
  - owns RAG provider client / prompt executor runtime binding
- `packages/rag-agent`
  - owns rag role prompt assets、typed task packet 与 typed evidence packet
- `apps/app-api`
  - 只消费 observability-safe prompt metadata，不参与 prompt assembly

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
- 你不得改写 policy / authz / serving-surface / scope truth
- 你不得用开放域世界知识补齐 institution-specific 缺口
- 如果请求是 `unsupported`、`ambiguous`、`unauthorized` 或 `not grounded by evidence`，必须
  abstain 或要求澄清
- 输出必须满足 typed schema，并接受 code-side finalization

可直接复用的参考 block 应保持在这个量级：

```text
You are an institution-scoped campus assistant.
Never override policy, authorization, serving-surface, or scope truth supplied
by code and typed packets.
Never use open-world knowledge to fill institution-specific gaps.
If the request is ambiguous, unauthorized, unsupported, or not grounded by
evidence, abstain or ask for clarification.
Return only schema-compliant output. Code-side finalization is authoritative.
```

这段 block 的职责只有：

- 固定 repo 级产品姿态
- 固定 “prompt 不是边界” 的长期规则
- 防止 package-local prompt family 漂移成各自的私有产品定义

它不负责：

- routing
- authz
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
- 把 routing / authz / serving truth 写成 prompt 文案
- 把 prompt 当作 agent graph 的唯一真相源

repo 最终追求的是：

- 一个极薄、稳定、可版本化的 repo-global invariants block
- 按 supervisor / agent / mode 拆分的 package-owned prompt family
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

- `packages/rag-agent` 的 prompt family 只负责 `answer / clarify / no-answer /
  unsupported` 的 grounded wording
- Python worker 当前不拥有 production supervisor terminal prompt family；
  non-delegate terminal routing 由 Go direct terminal path 返回，Go 继续负责
  delegated agent response finalization
- `packages/retrieval-core` 不拥有 top-level system prompt
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

### Supervisor Runtime Prompt Boundary

- 不拥有长期 prompt 文案
- 只负责 execution admission、transport、request packaging
- owns deterministic supervisor terminal wording
- owns runtime policy / routing frame / handoff projection
- 不拥有 retrieval evidence ranking 和 collection-specific answer synthesis

### `packages/rag-agent`

- owns knowledge-path / `rag-agent` role instructions
- owns answer / clarify / no-answer / unsupported prompt families
- owns evidence-to-answer prompt packet assembly
- 不拥有 authz truth、serving truth、product identity truth

### `packages/retrieval-core`

- 不拥有 top-level task prompt
- 只拥有 evidence retrieval 与 safe evidence serialization helper

## Prompt Family Model

每个 agent 不维护一份“大 prompt”，而维护 `prompt family + mode`。

当前 production supervisor terminal path 不再维护 prompt family；clarify /
approval-required / out-of-scope / reject 的 deterministic terminal wording 由 Go
`supervisor-api` 的 direct terminal path 承接。若后续重新引入 LLM-assisted supervisor
wording，必须作为新的显式 workstream 重新定义 prompt family、eval gate 与 code
finalization，不得复用已删除的旧 supervisor prompt assets。

### Knowledge Path (`packages/rag-agent`)

- `rag_answer_v1`
- `rag_clarify_v1`
- `rag_no_answer_v1`
- `rag_unsupported_v1`

可选后续 family：

- `rag_rewrite_v1`
- `rag_compare_answer_v1`
- `rag_historical_answer_v1`

## Prompt Asset Placement

prompt assets 长期放在各自 package source tree 内，而不是集中堆到 repo root：

- `packages/rag-agent/src/campus_rag_agent/prompts/`

prompt-facing vocabulary 规则固定为：

- package path / runtime target 继续可以保留在 owner metadata 与代码装配面
- model-facing `<role>` 文案默认使用 capability wording 或 forward family label
- 不把 `rag-agent` / `navigation-agent` 这类 raw runtime target 当作默认 prompt persona
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

## Trusted Vs Untrusted Zones

prompt packet 长期固定拆成 trusted / untrusted 两区。

### Trusted Zone

只允许放：

- role instructions
- hard invariants
- output contract
- task packet 中的 typed fields
- explicit safe summaries

### Untrusted Zone

只允许放：

- retrieved snippets
- external web text
- user-provided free text
- imported note / memory text
- operator-entered annotations

规则固定为：

- untrusted zone 永远不能写成 instructions 口吻
- 不把 evidence snippet 拼到 role instructions 里
- 不让 retrieval content 覆盖 system / developer intent

推荐统一使用结构标签，例如：

- `<role>`
- `<invariants>`
- `<task>`
- `<evidence>`
- `<output_contract>`

## Task Packet Contract

task packet 由 code 生成，不由模型猜。

第一版推荐字段：

- `request_id`
- `mode`
- `language`
- `task_kind`
- `resolved_scope`
- `requested_capability`
- `personalization_mode`
- `allowed_actions`
- `forbidden_actions`
- `response_constraints`
- `output_schema_name`

RAG agent 可额外带：

- `query_plan_kind`
- `clarification_reason`
- `canonical_entity_ids`
- `citation_expected`
- `no_answer_reason`
- `semantic_outcome_hint`

补充推荐字段：

- `grounding_required`
- `freshness_sensitive`
- `high_structure_mode`

这些字段的目的不是把 policy judgement 交给 prompt，而是让 prompt executor 与 post-LLM validator
在同一套 typed contract 上工作。

## Evidence Packet Contract

evidence packet 必须结构化，而不是大段自由拼接。

每条 evidence 至少包含：

- `doc_id`
- `source_title`
- `detail_label`
- `structural_path`
- `snippet`
- `safe_summary`

如场景需要，还可带：

- `canonical_course_id`
- `canonical_program_family_id`
- `content_role`
- `source_rank`

禁止直接注入：

- raw registry rows
- raw JWT / raw auth envelope
- hidden internal memory
- full prompt history dump

## Personalization Rules

prompt 只能消费已经过 code 过滤的 personalization inputs。

允许进入 prompt 的只包括：

- `user_visible` profile memory
- confirmed session slots
- safe actor claim terms

不允许进入 prompt 的包括：

- `internal_only` profile memory
- raw auth provider payload
- 未经投影的 long-term memory

长期规则保持与
`docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
一致：

- personalization 可以影响 wording、clarification、preference
- 不能扩大 visibility / entitlement truth

## Observability And Storage

默认 observability 只记录 prompt metadata，不记录 raw prompt。

最小记录字段：

- `prompt_id`
- `prompt_version`
- `template_sha256`
- `model`
- `request_id`
- `mode`
- `variables_schema_version`
- `output_schema_version`
- `citation_count`
- `grounding_verdict`
- `policy_verdict`

默认不记录：

- raw full prompt
- raw full answer
- raw transcript
- raw snippet dump
- raw long-term memory

如需 debug：

- 必须显式 opt-in
- 必须走 redaction / minimization
- 不得把 debug payload 视为长期默认日志真相

## Eval And Release Gate

prompt 变更不是纯文案改动，而是 release-relevant change。

每次 prompt family 变更至少要经过三层 gate：

1. `schema gate`

- prompt variables 是否齐全
- model output 是否满足 typed schema

1. `policy gate`

- clarify / no-answer / deny-path / approval-required 是否正确
- `policy_refusal`、`out_of_scope`、`restricted_access_denied` 的区分是否正确

1. `quality gate`

- groundedness
- citation completeness
- product wording quality
- ambiguity handling quality
- `unsupported_by_evidence` abstention 是否正确

第一版直接复用现有 repo eval truth：

- `student_rules` live accept
- `curriculum_plan` live accept
- alias / family ambiguity regression
- restricted deny / fail-close regression
- out-of-scope / policy-refusal / unsupported-by-evidence regression

prompt version bump 必须与 eval artifact 一起进入变更记录。

## Post-LLM Contract Expectations

长期上，`post-LLM contract` 不应只检查“有没有返回结构化对象”。

至少要补齐以下校验：

1. `schema gate`

- provider 返回是否满足 strict schema

1. `citation gate`

- `citation_expected=true` 时，`completed` 结果不得出现 `0` supporting sources

1. `grounding gate`

- 回答中的关键对象名、条件、时间、数量和制度名，必须能在 evidence packet 找到支持
- 如果关键 claim 找不到支持，应自动降级到 `unsupported_by_evidence`

1. `deny-path gate`

- restricted / hidden / unauthorized 内容不得通过 wording 绕出站

1. `freshness gate`

- freshness-sensitive 问答不得越过 runtime opening policy 自行作答

## Current Gap To Best Practice

当前 repo 方向已经基本正确，但与长期最佳实践相比仍有一个明确缺口：

1. claim-level grounding validator 已落地，但仍是最小可用强度

- 当前已对 prompt-generated completed answer 执行 answer-to-evidence 校验，并对 title /
  time / requirement claim 做最小提取
- 但还没有覆盖更广的 claim 类型，也还不是完整的 cross-provider grounded generation runtime

补充说明：

- hallucination failure-class eval lane 已经显式拆开，不再是当前主要 gap
- repo-default prompt metadata sink 已补齐到 `apps/app-api` / operator / eval
  runtime surface
- `refusal` / `incomplete` / `content-filter` 现在会以 observability-safe typed
  product state 留痕，而不是只作为 fallback reason
- 当前剩余 gap 主要集中在 grounding validator 深化

## First-Rollout Strategy

第一版 prompt 不做“大一统重构”，而做增量落地。

### 继续保持 code-owned 的部分

- supervisor routing
- supervisor deterministic terminal wording
- authz / visibility gate
- serving-surface filter
- retrieval planning
- canonical entity / alias resolution
- high-precision structured answer composer

### 第一版优先 promptify 的部分

- rag clarify wording
- rag no-answer wording
- rag answer naturalization

### 第一版不建议立即 promptify 的部分

- curriculum 课程表 / 学期课表高结构答案
- handbook procedure / materials / time 的高精度 deterministic path
- restricted deny path final safety semantics

原因：

- 当前这些路径已经有 deterministic repo truth
- 直接切成 prompt-first 会扩大 regression 面

## Current Repo Implication

对当前 repo 的直接结论是：

- 我们需要显式 prompt architecture，而且当前产品主链路已经落地第一版 runtime seam
- 但不需要把系统改写成 prompt-first RAG
- supervisor terminal prompt family 当前已移除；deterministic terminal wording 由 Go
  direct terminal path 承接
- knowledge-path prompt 应按 mode 拆分，并避免把 raw runtime target label 写成 model-facing
  persona
- 结构化、高精度场景继续优先 deterministic composer
- 幻觉治理的主力仍然是 `scope/evidence/finalization/eval`，而不是继续把 system prompt 写得更长

## 当前接受的运行时基线

当前 repo 的稳定运行时基线是：

- package-owned prompt registry、prompt packet 与 strict validation seam
  已成为 knowledge path 产品主链路的一部分
- `apps/supervisor-api` 已承担 prompt config admission summary；Python
  `apps/supervisor-agent-worker` 仍实际创建 RAG provider client / prompt executor，并将
  prompt trace 接入现有 diagnostics / observability
- provider-backed strict structured outputs、fail-close refusal handling 与 typed
  prompt metadata 已成为 repo-default posture
- supervisor 的 `policy gate + scope gate` 与 knowledge-path grounding validator
  共同承担 prompt-side hallucination control，而不是把控制责任退回“更长的 system prompt”
- `curriculum` 高结构答案、`handbook procedure/materials/deadline/time` 高精度 path 与
  restricted deny final semantics 继续保持 deterministic-first protected path

仍属当前 follow-up 但不在本文维护执行顺序的工作：

- 更强的 provider-agnostic grounded-generation runtime
- 更广的 claim taxonomy 与 agent-side unsupported diagnostics
- prompt-family live gate artifact 的持续更新

这些工作属于当前项目级 active lane，执行顺序与完成状态以
`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`、对应 workstream `STATE.md` 与对应
active plan 为准。

## 外部参考

以下外部资料用于 informing best practice，不替代 repo 内 source of truth：

- OpenAI Prompting
  - `<https://platform.openai.com/docs/guides/prompting`>
- OpenAI Responses vs Chat Completions
  - `<https://platform.openai.com/docs/guides/responses-vs-chat-completions`>
- OpenAI Structured Outputs
  - `<https://platform.openai.com/docs/guides/structured-outputs`>
- OpenAI Evaluation Best Practices
  - `<https://platform.openai.com/docs/guides/evaluation-best-practices`>
- OpenAI Safety Best Practices
  - `<https://platform.openai.com/docs/guides/safety-best-practices`>
- OpenAI Moderation Guide
  - `<https://platform.openai.com/docs/guides/moderation`>
- OpenAI Safety In Building Agents
  - `<https://developers.openai.com/tracks/building-agents/`>
- OpenAI Model Spec
  - `<https://model-spec.openai.com/`>
- Azure Advanced Retrieval-Augmented Generation
- Azure Groundedness Detection
- Azure RAG Evaluators
- Anthropic Citations
- Google Grounding Support / Grounded Generation guidance
- Self-RAG

## 相关稳定文档

- `docs/architecture/current-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.m
  d`
