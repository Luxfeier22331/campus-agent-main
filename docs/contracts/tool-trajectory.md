---
doc_type: contract
owner_boundary: apps/execution-control
status: active
---
# 工具轨迹合同

## 边界

`tool_trajectory.v2` 是供执行诊断和评测消费的工具决策投影。它不是 Langfuse DTO、浏览器
合同、Temporal history 结构或 provider response。

## 顶层结构

投影包含：

- `schema_version=tool_trajectory.v2`；
- request、run 与 trace 标识；
- 可选的 conversation、`surface`、environment 与 release 标识；
- `available_tools`；
- `decision_kind=direct_answer|tool_call|fail_closed`；
- 适用时的 selected tool 或拒绝原因；
- 对外的 `tool_calls[]`；
- 内部的 `internal_tool_calls[]`。

该投影从有界 run/step/result 数据派生，不需要原始 prompt、provider response、source body 或
Temporal history replay。

## 模型可见调用

`tool_calls[]` 记录 Primary Agent 可见的 function call 与 handoff。知识 handoff 记为
result kind 是 `agent_handoff` 的 `knowledge_query`；内部搜索不进入该列表。

每次调用可以携带 tool call id、tool name、status、result kind、duration、argument
shape/hash、拒绝原因和可公开的 provider/model 标识。

## 内部搜索调用

`internal_tool_calls[]` 按顺序记录 Knowledge Agent 的 `knowledge_search`。除通用字段外，每次
搜索还包含：

- 正整数 `search_ordinal`；
- 可用于评测的 `{target, include_history}` arguments；
- 可选 query hash；
- outcome；
- candidate 与 discarded 数量。

搜索 query 原文与 evidence snippet 不属于 trajectory 字段。获准评测所需的 RAG 文本来自
`agent_runtime_eval_projection.v2`。

## 决策语义

- `direct_answer`：未选择模型可见工具；
- `tool_call`：已准入的 SDK function tool 或 handoff 已执行；
- `fail_closed`：合同、配置、策略或执行条件拒绝了本次 run。

澄清、拒绝和普通直接回答不得伪装成工具。

## 禁止数据

trajectory 必须在写入前拒绝以下数据，不能事后再脱敏：

- 原始 prompt、transcript、provider response 或 model output；
- 原始 tool arguments、retrieval query 或 source body；
- 原始 memory content 或 Hindsight identifier；
- credential、auth header、cookie、database URL 或 object-store location。

## 评测消费

`packages/eval-langfuse` 只解析 v2。它使用对外调用判断 Primary Agent 的工具选择，并使用内部
搜索序列计算 Ragas tool-call metric 及 target/history 诊断。答案质量和检索质量仍通过
execution eval projection 上相互独立的 Ragas metric 评估。

## 可执行来源

- `apps/execution-control/internal/httpapi/execution_projection_handlers.go`
- `apps/execution-control/internal/httpapi/tool_trajectory_projection_test.go`
- `packages/eval-langfuse/src/tool-trajectory.ts`
