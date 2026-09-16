---
doc_type: architecture
owner_boundary: agent-runtime
status: active
---

# Agent 框架

## 边界

`apps/agent-runtime` 负责 Agent Workflow 的单次模型 operation，包括 instruction、模型输入装配、
模型调用、本地函数调用、模型托管的 Web Search、结构化计划/重规划输出、最终自然语言输出和 SDK
trace。它不负责产品认证、Temporal 生命周期、持久步骤顺序、本地知识检索、函数工具准入、个人记忆
存储或最终投影持久化。

## 运行形态

每个在线回答由同一模型角色完成四类 operation，但“Workflow”指 Agent Workflow，不等同于
Temporal Workflow：

1. `solve` 在一次模型 operation 中直接回答简单请求，或将复杂目标拆成有依赖关系的步骤。
2. `execute_step` 执行当前步骤声明的候选来源，并在需要时进行多轮模型—工具调用；这一局部行为
   接近 ReAct，但系统没有把思维文本作为状态，也不实现显式 ReAct 状态机。
3. `replan` 根据已完成步骤、成功证据、`no_match` 和工具失败选择 `continue`（可保留或替换剩余步骤）或进入 `synthesize`。
4. `synthesize` 只使用聚合后的证据生成用户答案，不再调用检索工具。

execution-control 负责上述 operation 的持久顺序、依赖检查、重规划预算和最终收口；plan、候选来源、依赖和
replan decision 的语义规则由 `temporalruntime` 共享纯规则入口统一实现，Adapter 与 Temporal workflow
只保留各自信任边界的调用；Agent Runtime
只执行当前 operation。系统不使用 Knowledge Agent 或 handoff。历史配置槽位仍称为 `primary_agent`，
但它不是用户可见的 Agent 层级，也不是编排策略名。

所有 operation 的固定角色指令使用简体中文，并明确产品服务中央民族大学。未明确指定机构时，学校、
本校和校园均按中央民族大学理解；这属于单校产品身份，不由请求或环境变量动态选择。

本地函数工具集合由准入快照提供；`execute_step` 只能使用当前步骤的候选来源。每个步骤的
`candidateSources` 可以包含 `campus_search`、`web_search` 或 `personal_memory_recall`，但实际来源选择
由 Executor 在该步骤内完成，Replanner 可以为后续步骤调整来源。系统没有名为 `direct` 的策略分支。

重复 operation 投递受 execution-control 的 invocation receipt 约束。供应商调用已经开始但完整结果
尚未落盘时必须返回 `agent_attempt_uncertain`，不得再次调用供应商。Agent Runtime 不实现自己的
重试、receipt 或不确定结果恢复。

## 准入身份

execution-control 冻结本轮 `primary_agent` 的 `model_target.v1` hash 和工具运行时指纹。Agent Runtime
只接收预期目标 hash、会话上下文和本轮开放的工具，再从共同受信任的 Model Config 读取仍匹配该
hash 的 `model_runtime_config.v1`；它不接收或持久化工作流提供的 Provider API key，也不读取索引目录或调用
知识 Provider。
`campus_search` 仍由 execution-control handler 读取当前 Campus Docs collection、解析 embedding
配置并生成查询向量；Agent Runtime 只通过工具调用协议消费结果。

Agent Runtime 在模型调用前要求 Model Config 返回相同目标 hash；execution-control 在结果持久化和
Finalization 前继续校验该 hash。目标缺失或不一致都失败关闭，不使用旧配置或备用模型。API key
轮换不改变目标 hash。

## 模型输入

Agent Runtime 在创建中立 `ModelMessage[]` 时组装，再由 runner 转为对应 SDK 的输入：

- 已裁剪的近期完整会话片段；
- 存在已确认值时的有界会话状态；
- 本轮工具结果（只在工具实际执行后出现）；
- 当前用户消息。

当前用户消息只出现一次。字符预算在真实输入数组上计算；超过预算时从最旧处删除完整会话片段，
不保留脱离对应用户问题的 Assistant 消息。Agent Runtime 在结果中返回实际 `context_usage`，
execution-control 不预先构造另一份模型上下文摘要。

用户文本、对话、记忆和工具结果都是不可信数据，不能拼入 developer instruction。匹配的个人记忆只能
支持用户自身事实或偏好，不能被当作机构事实来源。`campus_search` 结果作为本轮函数工具结果进入 SDK
上下文；来源公开字段由 execution-control 在 Finalization 中从真实证据派生。托管 `web_search`
分别映射为 OpenAI 原生 Web Search 或 Gemini 原生 `googleSearch`。runner 从原生 annotation /
grounding support 提取 URL、标题和被支持的文本片段，统一交给 Workflow 编号、Synthesizer 引用，
Finalization 按正文实际引用派生 `web_page` 来源卡。Web Search 不进入本地 `tool_results` 或工具轨迹。
Google `searchEntryPoint.renderedContent` 通过 `search_suggestions` 保存到产品结构化消息并展示；
它不参与证据编号，也不进入后续模型上下文。

Solve 根据用户目标决定直接回答或生成步骤和候选来源；Executor 只能执行当前步骤允许的来源；Replanner 根据实际
结果重新决定剩余路径。`campus_search` 的 `no_match` 只说明当前 Campus Docs 没有找到证据，不会由
代码自动切换到 Web Search；如果后续仍需要公开网页证据，必须由 Replanner 产生包含 `web_search` 的
合法步骤。问题同时包含已覆盖和未覆盖事实时，Synthesizer 只回答成功证据支持的部分并生成普通正文；
普通函数工具失败可以与合法答案并存，但失败结果不得成为答案依据。用户答案只使用简洁的“暂未找到相关资料”
或“目前无法确认”等产品话术，不暴露内部资料范围、步骤或失败码；合同、身份、运行指纹和结果结构错误继续失败关闭。

## 输出与终态

Agent Runtime 对 `solve`（直接答案或计划结果）和 `replan` 返回结构化 operation 结果；Solve 不执行检索，
`execute_step` 返回步骤文本、证据和来源尝试，对 `synthesize` 返回非空 `final_output` 与已汇总的引用材料。
Agent Runtime 只校验 operation 输出的结构合同；execution-control 再统一校验每个 operation
的语义合同、依赖、引用位置和来源后，再写入 `execution_finalization_response_v9`。追问、资料不足、工具失败后
保留成功证据的部分答案都作为 `completed` 正文保存。

`AppendConversationMemoryActivity` 是产品终态成功后的独立副作用，不是 Agent 反思步骤，失败不会改写
已完成的产品终态。

## 可观测性

OpenAI instrumentation 与 Gemini runner 的模型 span 复用受信任的 OTel/Langfuse 链路，并传播 W3C
trace context。请求不能改变遥测配置，OpenAI SDK 保持 `traceIncludeSensitiveData=false`。trace 只包含
受控模型标识、用量、阶段结果和关联元数据，不包含 prompt、对话正文、evidence 正文、工具原始
载荷、供应商原始响应或认证材料。

## 相关文档

- [持久 Agent 运行时](./durable-runtime.md)
- [工具路由](./tool-routing.md)
- [检索服务](./retrieval-serving.md)
- [执行合同](../../contracts/tool-execution.md)
- [ADR-0084 单一 Agent 与机构知识边界](../../../.agents/notes/implemented/architecture/2026-07-29-adr-0084-agent-knowledge-tools.md)
- [Agent 编排研究参考](../../reference/agent-orchestration.md)
