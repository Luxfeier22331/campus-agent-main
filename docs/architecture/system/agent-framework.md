---
doc_type: architecture
owner_boundary: agent-runtime
status: active
---

# Agent 框架

## 边界

`apps/agent-runtime` 负责面向模型的 OpenAI Agents SDK run，包括 Agent instruction、模型调用、
函数调用、handoff、结构化终态和 SDK trace。它不负责产品认证、Temporal 生命周期、工具开放、
检索准入、个人记忆存储或最终投影持久化。

## 运行形态

一个 Temporal Agent Activity 调用一次 agent-runtime，并在同一个 SDK run 内完成 Primary Agent、
已开放函数工具和必要的 Agent handoff。SDK 内部操作不成为额外 Temporal activity。

execution-control 在 Activity 开始前冻结运行标识、供应商配置、可见工具、知识目标、期限和有界
上下文；agent-runtime 不能扩大这些边界。SDK `maxTurns`、输出限制和 abort signal 约束本次调用，
Temporal 负责 Activity 外层的 timeout、retry 与 cancellation。

## 模型输入

模型输入区分：

- 当前用户消息；
- 已裁剪的近期对话；
- 可选个人记忆；
- 上一轮有界工具结果与依据；
- 本轮工具返回值。

当前用户消息只出现一次，并位于动态输入末尾。用户文本、记忆、检索片段和工具结果都是不可信
数据，不能拼入 developer instruction。上下文装配、裁剪与多轮产品要求见
`../../product/run-context.md`。

## 输出

agent-runtime 返回严格结构化终态、公开与内部工具摘要、模型用量、运行指纹和 trace 关联。
execution-control 负责校验终态 schema 与依据引用并写入投影，不生成第二个答案。

Agent runtime 错误使用可判定的错误码；具体响应结构由 `../../contracts/tool-execution.md` 维护。
模型费用由 Langfuse 根据模型身份与用量计算，不进入 execution-control 费用字段。

## 可观测性

Agents SDK 与 OpenInference instrumentation 将模型 span 发送到受信任 Langfuse 链路，并传播
W3C trace context。请求不能改变遥测配置。模型输入输出可以按 Langfuse 合同进入受信任 trace，
但认证材料始终禁止。

## 相关文档

- `durable-runtime.md`
- `tool-routing.md`
- `agentic-retrieval.md`
- `prompt.md`
- `langfuse.md`
- `../../contracts/tool-execution.md`
