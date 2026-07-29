---
doc_type: architecture
owner_boundary: agent-runtime
status: active
---

# Agent 框架

## 边界

`apps/agent-runtime` 负责面向模型的 OpenAI Agents SDK run，包括 instruction、模型调用、可选函数
调用、结构化终态和 SDK trace。它不负责产品认证、Temporal 生命周期、知识检索、工具开放、个人
记忆存储或最终投影持久化。

## 运行形态

每个在线回答只有一个 Primary Agent 和一个最终答案所有者。Temporal 在调用 agent-runtime 前由
本地 grounding plan 判断是否需要 `PrepareGroundingContextActivity`，随后通过
`ExecutePrimaryAgentActivity` 执行一个 SDK run。系统不存在 Knowledge Agent、handoff、第二次答案
合成或终态后的模型反思。

当前执行策略为 `execution_strategy.v2` 的 `kind=direct`：

- 未获个人记忆授权时，最多一次模型调用且没有模型工具；
- 获授权时，最多两次模型调用和一次 `personal_memory_recall`；
- 知识 grounding 已在模型调用前完成，不消耗 SDK 工具轮次；
- `transport_schedule_lookup` 已注册但关闭。

重复 Activity 投递只能读取并返回身份一致的完整 invocation receipt。供应商调用已经开始但完整
结果尚未落盘时必须返回 `agent_attempt_uncertain`，不得再次调用供应商。agent-runtime 不自行实现
重试、receipt 或不确定结果恢复。

## 准入身份

execution-control 在创建 workflow 前始终冻结 `llm` 模型设置；grounding plan 选择文档范围时，额外
冻结 `embedding` 模型设置、当前 release、不可变 Qdrant collection 和 serving config。准入快照只
携带两个设置的非敏感 SHA-256，不携带 profile、role、revision 或 bundle；运行限制和
`tool_runtime_fingerprint.v2` 始终冻结。

在线检索使用 Qdrant 已融合的 dense+sparse RRF 分数做确定性排序，再执行去重、范围保底和 token
预算裁剪。没有外部 reranker 或 reranker 阈值，RRF 分数不是答案置信度。

agent-runtime 只消费已解析的 `llm` 设置和已经准备好的 grounding，不解析知识 release、collection
或检索 Provider。execution-control 在模型调用、结果持久化和 finalization 前校验对应 kind 的
配置 hash；配置缺失、当前配置旋转或 hash 不一致都失败关闭。

## 模型输入

模型输入按以下顺序装配：

- 已裁剪的近期对话；
- 存在已确认值时的有界会话状态；
- 本轮 `grounding_context.v2` 的最小模型视图；
- 当前用户消息。

当前用户消息只出现一次。用户文本、对话、记忆和检索片段都按不可信数据处理，不能拼入 developer
instruction。`final_model_context.v3` 不再向模型注入上一轮依据或工具结果。Primary Agent 只能把
本轮 grounding 中的 `evidence://` 标识写入终态 `evidenceRefs`；个人记忆和上一轮回答不能成为本轮
正式来源。

grounding status 只描述检索范围覆盖，不判断证据是否足以回答：`not_required` 只允许无需机构事实的
一般请求直接回答；准入时冻结的 `allow_ungrounded_answer` 只对简单社交、能力或身份介绍，以及用户
已提供完整正文的改写、润色和翻译为 true。其他 `none` 路径仍不得无依据作答。`empty` 不能生成
机构事实；`partial` 可以引用现有依据回答可分离的部分，并在
用户请求仍有未获支持的部分时明确说明；`ready` 的机构事实答案必须引用本轮依据，但依据仍可能不足，
此时应返回终态 `unsupported_by_evidence`。该终态不是新的 grounding status；任何状态都不能用模型
记忆补齐学校事实。

上下文超过预算时按完整对话片段从最旧处裁剪，不保留脱离对应用户问题的 Assistant 消息。只有已确认
slot 或有效选择对象的会话状态进入模型；单独的轮次数不进入模型。具体产品多轮要求见
`../../product/run-context.md`。

## 输出与终态

agent-runtime 返回严格结构化终态、有序真实工具调用摘要、模型用量、运行指纹和 trace 关联。
execution-control 校验 grounding 绑定和依据引用，派生公开来源并写入
`execution_finalization_response_v5`。该响应不含 `session_update`，finalization 不调用模型也不改写
答案。

`AppendConversationMemoryActivity` 是产品终态成功后的独立副作用，只追加已完成对话；它不是 Agent
反思步骤，失败不会改写已经完成的产品终态。

## 可观测性

Agents SDK 与 OpenInference instrumentation 将模型 span 发送到受信任 Langfuse 链路，并传播
W3C trace context。请求不能改变遥测配置，SDK 保持 `traceIncludeSensitiveData=false`。trace 只
包含受控模型标识、用量、阶段结果和关联元数据，不包含 prompt、对话正文、grounding 正文、工具
原始载荷、供应商原始响应或认证材料。

## 相关文档

- `durable-runtime.md`
- `tool-routing.md`
- `agentic-retrieval.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
- `../../reference/agent-orchestration.md`
