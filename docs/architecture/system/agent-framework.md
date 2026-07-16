---
doc_type: architecture
owner_boundary: agent-runtime
status: active
---
# Agent 框架

## 边界

`apps/agent-runtime` 拥有面向模型的 OpenAI Agents SDK loop，不拥有产品认证、持久生命
周期、检索准入、来源事实或最终投影持久化。

## 运行形态

一个 Temporal Agent Activity 调用一个 SDK run，其中包含：

1. primary agent；
2. 已开放 model-visible function tool；
3. 官方 `knowledge_query` handoff；
4. Knowledge Agent 和 internal `knowledge_search`；
5. 一个 structured terminal output。

execution-control 从 runtime config 注入 deadline、turn、output、search 和 context limit。
agent-runtime 应用 SDK `maxTurns`、`maxTokens` 和 abort signal；Temporal 保留外层 Activity
timeout。具体数值属于配置，不在架构文档冻结。

handoff 或 function call 是 SDK operation，不是 Temporal activity 或 durable replan phase。

## 模型输入

`final_model_context.v2` 包含历史 conversation turn、session state、有界旧 evidence/tool
summary 和已完成 memory recall block。agent-runtime 将其转换为 SDK `AgentInputItem[]`，
再把当前 user message 作为最后一个 user item 添加一次。动态 context 不进入 developer
instruction。

execution-control 在 memory 和旧结果 enrichment 后计算 Unicode character budget，并按合同
裁剪旧 tool result、memory、turn 和 evidence snippet。当前输入过大或无法安全裁剪时返回
`context_budget_exceeded`。

## Agent 所有权

primary agent 做第一次 semantic decision，可以回答、澄清、拒绝、调用已开放工具或 handoff
知识问题。app-api 不做 intent classifier，execution-control 不做 semantic router。

Knowledge Agent 收到 handoff state 和当前 query-serving target，可以且只能调用
`knowledge_search`。它每次搜索一个 target，证据充分后停止；只有明确历史或比较问题才
包含历史版本。相同 normalized target/query/history 调用按合同拒绝重复。证据不足时返回
`unsupported_by_evidence`，模型记忆不能补齐事实。

## 工具准入

`configs/runtime/tools.v5.json` 与 `configs/runtime/tool-function-schemas.v2.json` 定义 exposure
和 strict model argument。schema、endpoint 或实现存在都不会自动开放工具。

execution-control 提供 request-visible tool name 和 admitted knowledge target，SDK 不得扩大
任何一项。当前具体清单以 registry 为准，不在本文复制。

## 输出与 Trace

agent-runtime 返回 structured terminal envelope、public/internal tool summary、token usage、
runtime fingerprint 和 trace correlation，并传播 W3C `traceparent`/`baggage`。

runtime failure 使用稳定 non-retryable code，JSON 和 terminal SSE 使用同一 shape。code 清单
由 executable contract 维护。

OpenAI Agents SDK span 通过 OpenInference 和 Langfuse OTel processor 采集。配置 OTLP
exporter 时，受信任 Langfuse trace 可以包含 model I/O；request 不得改变 telemetry config。

execution-control 校验 evidence ref 并写最终 projection，不生成或改写答案。PostgreSQL 保存
token count，不自行计算 model cost；cost 由 Langfuse 根据 model identity 和 usage 计算。

## 相关文档

- `tool-routing.md`
- `agentic-retrieval.md`
- `durable-runtime.md`
- `../../contracts/tool-execution.md`
