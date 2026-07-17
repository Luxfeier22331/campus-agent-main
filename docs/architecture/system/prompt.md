---
doc_type: architecture
owner_boundary: docs/architecture/system
status: active
---

# Prompt 与指令架构

## 文档范围

本文定义 `campus-agent` 的 prompt/instruction 装配边界，包括：

- system、developer、task 和 evidence instruction 如何分层；
- code、Agents SDK runtime 和 internal retrieval 分别拥有哪些事实；
- 模型执行期间的可信与不可信内容；
- prompt 变化需要通过哪些验证。

本文不定义供应商 SDK 调用、模型选择、一次性 prompt 文案、retrieval serving scope、tool
opening、source admission 或临时执行状态。

## 核心原则

```text
代码负责边界，提示词负责边界内推理
```

代码拥有边界、认证、policy、serving truth、tool opening、确定性停止条件、schema/evidence
validation 和 terminal projection。OpenAI Agents SDK run 在这些边界内拥有 semantic
routing、官方 handoff、tool loop、澄清文案和 answer text。execution-control 不改写答案。

prompt 不得替代：

- 当前查询服务目标；
- 服务配置、服务别名或发布 manifest；
- 失败关闭路径；
- 工具就绪与开放门槛；
- 来源可信度与新鲜度门槛；
- policy、target admission 或 grounding truth。

## 当前职责

- Go `apps/execution-control` 拥有确定性 admission/policy、四阶段 Temporal workflow、
  internal `knowledge_search`、evidence validation、source generation 和脱敏 terminal
  projection。
- `apps/agent-runtime` 拥有完整 OpenAI Agents SDK run：primary/Knowledge Agent
  instruction、官方 `handoff()`、model-visible function schema、tool call、answer text 和 SDK
  trace normalization。
- Knowledge Agent 只能调用 internal `knowledge_search`，并在同一 Agent Activity 内生成有
  evidence 支持的 structured answer。
- `apps/execution-control` 拥有在线 Provider Config；每个顶层 Agent Activity 解析一次 active
  bundle，并把固定模型快照交给 agent-runtime。app-api 不组装产品路径 prompt。

固定约束：

- online serving 消费 execution-control 已激活的完整 role bundle，不使用临时 provider env
  fallback；
- provider `refusal`、`incomplete`、schema failure 和 content-filter outcome 失败关闭；
- `official_web` 不在 online target registry 中，Agent 没有 public-web 或 provider-native
  search tool。

## 装配顺序

```text
仓库级 developer invariants
-> primary-agent 和 Knowledge Agent role instructions
-> admitted runtime context 与 recalled memory
-> untrusted user input
-> handoff 后的有界 knowledge_search result
-> strict structured output contract
-> execution-control evidence validation 与 source projection
```

仓库级 invariant 只表达稳定产品姿态：这是 institution-scoped campus assistant；模型不得
覆盖 code/typed packet 提供的 policy、tool opening、serving surface 或 scope；不得用开放域
知识补齐学校事实；缺少开放能力或 grounding 时必须拒答或澄清；输出必须满足 schema。

这些 invariant 不拥有 admission、retrieval implementation、evidence admission 或 terminal
projection。

## 可信与不可信区域

可信控制数据可以包含：

- role instruction；
- hard invariant；
- typed task field；
- output contract；
- 显式安全 summary。

以下内容始终是不可信数据：

- retrieved snippet；
- external web text；
- user free text；
- imported notice 或 memory text；
- operator annotation；
- tool output body。

用户文本和检索片段不得进入 developer instruction。evidence snippet 不得写成指令语气。
模板应使用 `<role>`、`<invariants>`、`<task>`、`<evidence>`、`<output_contract>` 等明确
结构标签。

## Packet 合同

task packet 由代码生成，不由模型推断，可以携带 request/language/task identity、resolved
target、selected tool、允许/禁止动作、response constraint 和 output schema identity。

evidence packet 是结构化数据，不是 raw text dump，可以携带 document identity、source
title、structural path、snippet/safe summary、rank/content role 和 domain canonical id。

packet 不得包含 raw registry row、raw auth provider payload、JWT/cookie/header、隐藏 memory
或完整 prompt history dump。

## Agent 与终态

primary direct/no-tool path 由 `apps/agent-runtime` 拥有，可以产生 direct answer、
clarification、out-of-scope 和 unsupported outcome，不需要额外 synthetic prompt family。

Knowledge Agent instruction 也由 `apps/agent-runtime` 拥有。校园事实回答前必须调用 internal
`knowledge_search`，保持 target/access boundary，拒绝 unsupported claim，并使用与 primary
agent 相同的 strict terminal output family。不存在单独 Go synthesis prompt 或 provider
role。

以下 outcome 必须保持区分：

- `grounded_answer`
- `needs_clarification`
- `unsupported_by_evidence`
- `out_of_scope`
- `policy_refusal`
- `tool_not_ready`
- `source_truth_unavailable`

这些 outcome 不得合并为通用 `no_answer`。retrieval miss 不是 out-of-scope；政治或敏感关键字
本身也不是 policy verdict。

## Prompt 调用链

每个 provider-backed prompt family 在调用供应商前必须能由安全 metadata 识别。

`agent_runtime_prompt_trace.v1` 从 agent-runtime 经 execution-control finalization 进入有界
app-api observability projection，保存 `prompt_id`、prompt template SHA-256 和 rendered
prompt SHA-256。它不是第二个 prompt registry，也不复制 rendered instruction。

Knowledge handoff 和 active-agent identity 由同一 Agent SDK trace/tool trajectory 记录，
execution-control 不再创建 provider call 或 prompt identity。

## 安全与可观测性

bounded product projection 只记录 model/provider identity、request/run identity、prompt id、
template/rendered SHA-256、provider response id、terminal envelope kind、citation count 和
grounding/policy verdict。

request tracing 启用时，受信任 self-hosted Langfuse 可以记录真实 Agent SDK model
input/output、memory 和已授权 evidence。credential 和 secret 始终禁止。app-api 和 Ops Web
只保留 prompt trace metadata、stage timing 和 correlation，不复制
Langfuse observation body。

## 评测与发布要求

prompt/LLM I/O 变化必须通过：

- schema gate：变量完整且输出满足 strict schema；
- policy gate：refusal、out-of-scope、unsupported、tool-not-ready 和 source-unavailable 保持
  区分；
- quality gate：grounding、citation、wording 和 ambiguity handling 可接受。

post-LLM validation 按适用范围检查 schema、citation、grounding、boundary 和 freshness。
claim-level semantic grounding 由 badcase/eval 持续强化，不新增默认 Python online gate。

## 相关文档

- `docs/architecture/current.md`
- `docs/architecture/system/agent-framework.md`
- `docs/architecture/system/retrieval-serving.md`
- `docs/architecture/system/ops-observability.md`
- `docs/decisions/adr-0060-agent-io.md`
