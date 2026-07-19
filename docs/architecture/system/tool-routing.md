---
doc_type: architecture
owner_boundary: tool-routing
status: active
---

# 工具路由

## 边界

本文定义工具如何开放、由谁选择以及如何调用。精确工具名称、暴露范围、schema、handler、
timeout 和投影策略只由以下可执行注册表维护：

- `configs/runtime/tools.v5.json`；
- `configs/runtime/tool-function-schemas.v2.json`。

注册表、endpoint 或实现存在都不会自动向模型开放工具。

## 职责

- app-api 负责身份、会话和产品传输，不分类用户意图或维护工具 allowlist；
- execution-control 根据注册表、运行状态和访问边界提供本次 run 可见的工具与知识目标；
- OpenAI Agents SDK 负责回答、澄清、拒绝、函数调用和 handoff 的语义选择；
- 工具 handler 负责自身认证、参数校验、数据访问和结果合同；
- finalization 校验工具与依据投影，不重新选择工具或改写答案。

## Handler

`execution_control_internal_query` handler 在同一个 Agent Activity 内调用带认证的
execution-control 读取接口。接口重新校验运行标识、工具准入和结果结构，再返回有界 JSON。

`agent_handoff` handler 使用 Agents SDK 官方 handoff 进入另一个 Agent，不创建新的 Temporal
activity。Knowledge Agent 的搜索策略见 `agentic-retrieval.md`，后端检索见
`retrieval-serving.md`。

## `requested_tool`

私有执行合同保留可选 `requested_tool`，仅用于调用方已经具备独立准入合同的内部执行。当前
公开聊天和 `packages/eval-langfuse` 产品路径均不设置该字段，由 Primary Agent 自行选择工具。
该字段不能选择知识目标、collection、版本、供应商或检索参数，也不能绕过注册表与终态校验。

## 投影

模型可见调用与内部调用形成有界工具轨迹，供运行诊断和评测使用。精确结构由
`../../contracts/tool-trajectory.md` 维护；原始模型参数、来源正文、凭据和后端响应不得进入
产品投影。

## 不允许的形态

- 在 Primary Agent 前增加文本意图分类器；
- 由浏览器或 app-api 选择知识目标与检索参数；
- 为每个工具或 handoff 创建 Temporal activity 与专用队列；
- 在 SDK 终态之后启动第二套语义规划或改写答案；
- 工具失败时回退到未注册的供应商搜索或现场采集。

## 相关文档

- `agent-framework.md`
- `agentic-retrieval.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
- `../../contracts/tool-read-model.md`
- `../../contracts/tool-trajectory.md`
