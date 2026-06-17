---
doc_type: architecture
truth_scope: execution
owner_boundary: prompt-runtime
status: active
created: 2026-06-13
updated: 2026-06-14
---

# Prompt And Instruction Current Runtime Baseline

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## 当前接受的实现基线

当前 repo 已经把 prompt / instruction runtime 收口为显式 supporting architecture +
code-owned runtime seam。当前接受的实现基线是：

- Go `apps/execution-control` 拥有 intent framing、routing、policy 与 response
  finalization
- Go-owned knowledge / RAG runtime 拥有 ambiguity handling、query planning、
  retrieval-oriented answer shaping
- repo-owned retrieval runtime seam 拥有 evidence retrieval kernel

补充约束：

- repo-global developer invariants 由 `packages/prompt-runtime` 持有
- package-owned role prompt 当前由 Go-owned knowledge / RAG runtime 与
  `packages/prompt-runtime` contract 持有；Python production legacy terminal prompt
  family 已移除
- prompt-facing persona / family wording 应使用 `knowledge` 或中性的 knowledge-path
  wording，不把 `knowledge` 当默认对外标签
- retired Python bridge 的 prompt stack 已从 active workspace 删除；developer
  invariants、role prompt、trusted task packet、untrusted user/evidence packet 的
  active owner 分别落在 `packages/prompt-runtime` 与 Go-owned execution path
- `packages/prompt-runtime` 负责 provider-facing prompt contract validation、
  provider-backed strict structured outputs、provider response normalization，并生成
  validated `PromptTrace`
- active RAG prompt execution 不再通过 Python worker-local executor；Go-owned
  Temporal RAG path 与 `packages/prompt-runtime` contract 承接 provider-facing
  validation / normalization / trace
- provider `refusal`、`incomplete` 与 request/schema failure 必须在 RAG prompt execution
  path fail-close，不得被当作 schema-valid success 放行
- `apps/app-api`、operator observability 与 eval runtime 统一投影 `prompt_id`、`prompt_
  version`、`template_sha256`、`prompt_runtime_state`、`prompt_runtime_detail`
- curriculum / handbook 的 deterministic-first protected paths 继续保持
  deterministic-first，不因 prompt rollout 回退成 prompt-first
- 当前 phase 顺序、剩余 rollout 与 pending work 不在本文维护；应以
  `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与 GSD SDK / Codex native
  session state 为准
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
- `semantic verification prompt`
  - 只在 badcase/eval-driven hardening lane 打开时，检查 synthesis 输出是否仍被
    evidence 支持；当前 Go online RAG 默认只承诺 evidence-integrity verification

固定规则：

- retrieval runtime seam 不拥有 top-level planner prompt
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
- account / operator access 结论
- source-trust 提权
- unrestricted live/web fallback

## 外部最佳实践对齐（2026-04-12）

本仓库当前 prompt runtime 形态与 OpenAI 官方文档的主线建议一致：

- 新的 text generation app 默认走 Responses API，而不是继续围绕旧 Chat Completions 组织产品主链路
- 应用拥有的高优先级规则放在 `instructions` / `developer` 层，用户输入与 evidence 继续留在低优先级输入区
- 工具以结构化 `tools` / function schema 形式暴露给模型，由模型基于 prompt
  判断是否调用工具；不能把工具选择协议写成自然语言假 schema，也不能把每个
  产品介绍或寒暄拆成 tool / capability
- untrusted content 不进入 developer instruction zone；节点间数据交换尽量走 strict structured
  outputs，而不是自由文本通道
- prompt / model 变更应绑定持续 eval，而不是只靠人工感受或一次性 smoke

对应官方资料：

- OpenAI Responses migration guide
  - `<https://developers.openai.com/api/docs/guides/migrate-to-responses#responses-benefits>`
- OpenAI tools guide
  - `<https://developers.openai.com/api/docs/guides/tools>`
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
- 用 prompt 软约束代替 serving filter、capability opening gate 或 source-trust gate
- 把 retrieval snippets 或 external content 直接拼进 trusted instructions 区
- 用一份 monolithic mega prompt 覆盖所有 agent、所有 mode、所有数据面

## Prompt 不是边界

以下内容长期不得依赖 prompt-only 软约束：

- current query-enabled scope
- runtime profile / serving alias / release manifest
- fail-close deny path
- capability opening / readiness gate
- source-trust / freshness gate

这些 truth 继续由：

- `apps/app-api`
- `apps/execution-control`
- repo-owned retrieval runtime seam
- registry / runtime profile / release manifest

共同拥有。

## Planner Prompt 不是执行边界

长期 agentic retrieval 下，planner prompt 同样不是边界 owner。

它不能替代：

- runtime profile / serving posture
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
- `capability_not_ready` 当前问题属于校园问答目标，但对应能力尚未达到主链路 opening gate
- `source_truth_unavailable` 当前问题需要的 source truth 或 current-state truth 尚不可可靠消费

补充约束：

- transport / runtime status 可以在过渡期继续保持 `completed`、`needs_clarification`、`no_an
  swer`、`rejected`、`approval_required`、`error`
- 但 observability、eval truth、prompt packet 与 operator projection 长期不得再把 `out_of_
  scope`、`unsupported_by_evidence`、`policy_refusal`、`capability_not_ready` 与
  `source_truth_unavailable` 混成一个模糊的 `no_answer`
- `capability_not_ready` 与 `source_truth_unavailable` 是 internal / operator vocabulary；
  用户可见文案应映射为“当前无法自动查询”“暂无可靠来源确认”或等价表达，不直接暴露内部 capability 名称。
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
- 不能因为第一次召回不理想，就隐式放宽 scope / source-trust / freshness 约束

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

1. `boundary hallucination`

- 把未开放 capability、未可靠摄入的 current-state truth 或内部 source material 包装成可确认答案

repo 的 hallucination control 必须分别针对这五类做 gate，而不是统一归类成“prompt 质量问题”。

## 所有权划分

### `apps/app-api` ownership

- 拥有 product-facing answer kind 映射与 operator-facing projection
- 不拥有 policy / scope / grounding 的最终真相判断

### `apps/execution-control` ownership

- 拥有 top-level `policy gate` 与 `scope gate`
- 拥有语义终态 finalization
- 长期上应区分 `policy_refusal`、`out_of_scope` 与普通 `needs_clarification`

### Knowledge Runtime Ownership

- 只处理已进入 in-scope knowledge path 的问题
- 拥有 ambiguity handling、retrieval planning、grounded answer
  synthesis、`unsupported_by_evidence`
- 不应承担通用 off-domain classification
- 不应把明显域外问题伪装成 handbook / curriculum 空召回

### Retrieval Runtime Ownership

- 只拥有 retrieval / evidence shaping / admitted source constraint execution
- 不拥有 top-level policy refusal 或 product scope judgement

### prompt family

- 只负责对应语义结果的 wording
- 不拥有 policy / scope / grounding truth
- 不得把“答不出来”的原因从结构化 verdict 退化回自由文本猜测
