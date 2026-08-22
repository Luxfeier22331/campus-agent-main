---
doc_type: architecture
owner_boundary: agent-runtime
status: active
---

# Agent 框架

## 边界

`apps/agent-runtime` 负责面向模型的 OpenAI Agents SDK run，包括 instruction、模型输入装配、模型
调用、可选函数调用、结构化终态和 SDK trace。它不负责产品认证、Temporal 生命周期、知识检索、
工具开放、个人记忆存储或最终投影持久化。

## 运行形态

每个在线回答只有一个 Primary Agent 和一个最终答案所有者。execution-control 通过
`ExecutePrimaryAgentActivity` 启动一个 SDK run。
系统不存在 Knowledge Agent、handoff、第二次答案合成或终态后的模型反思。

当前执行策略为 `execution_strategy.v2` 的 `kind=direct`：

- 个人记忆不可用时，最多一次模型调用且没有模型工具；
- 个人记忆可用时，最多两次模型调用和一次 `personal_memory_recall`；

重复 Activity 投递受 execution-control 的 invocation receipt 约束。供应商调用已经开始但完整结果
尚未落盘时必须返回 `agent_attempt_uncertain`，不得再次调用供应商。Agent Runtime 不实现自己的
重试、receipt 或不确定结果恢复。

## 准入身份

execution-control 冻结本轮 `primary_agent` 的 `model_target.v1` hash 和工具运行时指纹。Agent Runtime
只接收预期目标 hash、会话上下文和本轮开放的工具，再从共同受信任的 Model Config 读取仍匹配该
hash 的 `model_runtime_config.v1`；它不接收或持久化工作流提供的 Provider API key，也不读取索引目录或调用
知识 Provider。

Agent Runtime 在模型调用前要求 Model Config 返回相同目标 hash；execution-control 在结果持久化和
Finalization 前继续校验该 hash。目标缺失或不一致都失败关闭，不使用旧配置或备用模型。API key
轮换不改变目标 hash。

## 模型输入

Agent Runtime 在创建真实 `AgentInputItem[]` 时组装：

- 已裁剪的近期完整会话片段；
- 存在已确认值时的有界会话状态；
- 本轮工具结果（只在工具实际执行后出现）；
- 当前用户消息。

当前用户消息只出现一次。字符预算在真实输入数组上计算；超过预算时从最旧处删除完整会话片段，
不保留脱离对应用户问题的 Assistant 消息。Agent Runtime 在结果中返回实际 `context_usage`，
execution-control 不预先构造另一份模型上下文摘要。

用户文本、对话、记忆和工具结果都是不可信数据，不能拼入 developer instruction。当前在线合同
没有向 Agent Runtime 提供机构知识证据，也不包含来源引用字段。匹配的个人记忆只能支持用户自身事实
或偏好，不能被当作机构事实来源。未来 RAG 接入时，输入、工具和来源校验必须由新的可执行合同同时
定义。

## 输出与终态

Agent Runtime 返回严格结构化终态、有序真实工具调用摘要、模型用量、`context_usage`、运行指纹和
trace 关联。execution-control 校验终态和工具结果并写入 `execution_finalization_response_v6`。

`AppendConversationMemoryActivity` 是产品终态成功后的独立副作用，只追加已完成对话；它不是 Agent
反思步骤，失败不会改写已完成的产品终态。

## 可观测性

Agents SDK 与 OpenInference instrumentation 将模型 span 发送到受信任 Langfuse 链路，并传播 W3C
trace context。请求不能改变遥测配置，SDK 保持 `traceIncludeSensitiveData=false`。trace 只包含
受控模型标识、用量、阶段结果和关联元数据，不包含 prompt、对话正文、evidence 正文、工具原始
载荷、供应商原始响应或认证材料。

## 相关文档

- `durable-runtime.md`
- `tool-routing.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
- `../../decisions/adr-0084-agent-knowledge-tools.md`
- `../../reference/agent-orchestration.md`
