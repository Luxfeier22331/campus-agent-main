---
doc_type: architecture
owner_boundary: tool-routing
status: active
---

# 工具路由

## 文档边界

本文定义模型工具如何开放、由谁选择以及如何投影。精确名称、暴露范围、schema、handler 和
timeout 由以下可执行注册表维护：

- `configs/runtime/tools.v6.json`；
- `configs/runtime/tool-function-schemas.v3.json`。

注册表、endpoint 或实现存在都不会自动向模型开放工具。

## 当前状态

当前注册表只有两个工具：

- `personal_memory_recall` 为 `model_visible`，但只有本轮冻结授权允许时才进入 SDK 工具数组；
- `transport_schedule_lookup` 为 `closed`，不会进入新运行的 `visible_tool_names`。

培养方案、规章和其他正式文档统一由 execution-control 在需要时准备
`grounding_context.v2`。知识检索不是模型工具，不进入 `visible_tool_names`、SDK 工具轮次或
`tool_trajectory.v3`。系统没有客户端指定工具、Knowledge Agent、handoff 或知识 target 路由。

## 职责

- app-api 负责身份、会话和产品传输，不接收客户端指定的工具、文档范围或检索参数；
- execution-control 根据注册表和本轮授权冻结模型可见工具，并执行工具 handler；
- OpenAI Agents SDK 只在已开放工具中决定是否调用及其参数；
- handler 重新校验运行身份、授权、参数和结果合同；
- finalization 校验真实工具投影与依据引用，不重新选择工具或改写答案。

工具准入只能缩小能力，不能改变用户权限、开放关闭工具或选择 Provider。文档范围和 grounding
准入由 `retrieval-serving.md` 维护，不通过工具暴露。

## 执行方式

没有个人记忆授权时，Primary Agent 直接消费对话和 grounding，单次生成结构化终态。允许个人记忆
召回时，SDK 最多执行一次 `personal_memory_recall`，再由同一 Primary Agent 完成答案。

`execution_control_internal_query` handler 在同一个 Agent Activity 内调用 execution-control 的有界
读取接口。个人记忆 handler 重新校验冻结策略和运行身份后调用 Hindsight，只向 Agent 返回受限结果；
它不创建额外 Temporal Activity，也不把记忆正文写入普通投影。

班车工具保持关闭，在线 Agent 不以文档 RAG、模型记忆或现场网页搜索替代时刻表读取模型。工具
失败也不得回退到未注册数据源。

## 投影

真实 SDK 函数调用按发生顺序形成 `tool_trajectory.v3`。轨迹只包含当前工具词汇、状态、耗时和安全
摘要；知识 grounding 由独立的 `grounding.prepare` 阶段和 RAG 评测投影表示。

原始模型参数、记忆正文、凭据和后端响应不得进入产品投影。最终回答是否有知识依据由本轮
grounding 的 `evidence://` 引用校验决定，不能从工具调用数量推断。

## 禁止形态

- 由浏览器或 app-api 选择工具、文档范围、release 或检索参数；
- 把知识 grounding 伪装成 SDK tool call 或 `eval_safe_args`；
- 为每个 SDK 工具创建 Temporal Activity 或专用队列；
- 在 SDK 终态之后启动第二次规划、反思或答案改写；
- 工具失败时回退到未注册供应商搜索、旧工具或现场采集。

## 相关文档

- `agent-framework.md`
- `agentic-retrieval.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
- `../../contracts/tool-trajectory.md`
