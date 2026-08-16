---
doc_type: architecture
owner_boundary: agent-runtime
status: active
---

# Agent 框架

## 边界

`apps/agent-runtime` 负责面向模型的 OpenAI Agents SDK run，包括 instruction、模型输入装配、模型
调用、可选函数调用、结构化终态和 SDK trace。它不负责产品认证、Temporal 生命周期、Campus Docs
检索、工具开放、个人记忆存储或最终投影持久化。

## 运行形态

每个在线回答只有一个 Primary Agent 和一个最终答案所有者。execution-control 在调用 Agent 前执行
`RetrieveCampusDocsEvidenceActivity`，随后通过 `ExecutePrimaryAgentActivity` 启动一个 SDK run。
系统不存在 Knowledge Agent、handoff、第二次答案合成或终态后的模型反思。

当前执行策略为 `execution_strategy.v2` 的 `kind=direct`：

- 未获个人记忆授权时，最多一次模型调用且没有模型工具；
- 获授权时，最多两次模型调用和一次 `personal_memory_recall`；
- Campus Docs 检索在模型调用前完成，不消耗 SDK 工具轮次。

重复 Activity 投递受 execution-control 的 invocation receipt 约束。供应商调用已经开始但完整结果
尚未落盘时必须返回 `agent_attempt_uncertain`，不得再次调用供应商。Agent Runtime 不实现自己的
重试、receipt 或不确定结果恢复。

## 准入身份

execution-control 始终冻结 `llm` 与 `embedding` 模型设置、当前索引查询绑定和本轮查询 hash。
Agent Runtime 只接收已经解析的 `llm` 设置和本轮 `campus_docs_evidence` 数组，不读取索引目录或
调用检索 Provider。

execution-control 在模型调用、结果持久化和 Finalization 前校验对应配置 hash。配置缺失、轮换或
hash 不一致都失败关闭，不使用旧配置或备用模型。

## 模型输入

Agent Runtime 在创建真实 `AgentInputItem[]` 时组装：

- 已裁剪的近期完整会话片段；
- 存在已确认值时的有界会话状态；
- 本轮 `campus_docs_evidence` 数组；
- 当前用户消息。

当前用户消息只出现一次。字符预算在真实输入数组上计算；超过预算时从最旧处删除完整会话片段，
不保留脱离对应用户问题的 Assistant 消息。Agent Runtime 在结果中返回实际 `context_usage`，
execution-control 不预先构造另一份模型上下文摘要。

用户文本、对话、记忆和检索片段都是不可信数据，不能拼入 developer instruction。Primary Agent
只能把本轮 `campus_docs_evidence` 中的 `evidence://` 标识写入终态 `evidenceRefs`；个人记忆和
上一轮回答不能成为正式来源。

不需要机构事实的请求不添加 evidence 引用，无论数组是否为空或相关。需要机构事实时，数组为空或
证据不足必须返回 `unsupported_by_evidence`；数组非空不表示证据必然充分。机构事实答案必须直接
受本轮证据支持并引用匹配的 `evidence_ref`。

## 输出与终态

Agent Runtime 返回严格结构化终态、有序真实工具调用摘要、模型用量、`context_usage`、运行指纹和
trace 关联，不回传 Campus Docs 检索结果副本。workflow 分别把 Agent result 和原检索结果交给
Finalization；execution-control 校验身份与 evidence 引用、派生公开来源并写入
`execution_finalization_response_v6`。

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
- `agentic-retrieval.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
- `../../reference/agent-orchestration.md`
