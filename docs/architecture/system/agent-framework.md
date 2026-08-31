---
doc_type: architecture
owner_boundary: agent-runtime
status: active
---

# Agent 框架

## 边界

`apps/agent-runtime` 负责面向模型的 OpenAI Agents SDK run，包括 instruction、模型输入装配、模型
调用、本地函数调用、模型托管的 Web Search、原生文本回答和 SDK trace。它不负责产品认证、Temporal
生命周期、本地知识检索、函数工具开放、个人记忆存储或最终投影持久化。

## 运行形态

每个在线回答只有一个 Primary Agent 和一个最终答案所有者。execution-control 通过
`ExecutePrimaryAgentActivity` 启动一个 SDK run。
系统不存在 Knowledge Agent、handoff、第二次答案合成或终态后的模型反思。
Primary Agent 的固定角色指令使用简体中文，并明确产品服务中央民族大学。未明确指定机构时，学校、
本校和校园均按中央民族大学理解；这属于单校产品身份，不由请求或环境变量动态选择。

当前执行策略为 `execution_strategy.v4` 的 `kind=direct`：

- execution-control 提供的本地函数工具集合始终包含 `campus_search`，个人记忆可用时还包含
  `personal_memory_recall`；集合顺序没有路由语义；
- Agent Runtime 另外固定附加 Agents SDK 原生 `web_search` hosted tool；它不进入本地函数工具集合；
- 个人记忆不可用时，最多两次模型 turn，最多一次本地函数调用；
- 个人记忆可用时，最多三次模型 turn、两次本地函数调用；同一函数工具可以重复调用，次数只受本轮总
  `max_function_tool_calls` 限制；
- hosted `web_search` 不消耗本地函数调用预算；
- 问候、改写等不需要机构事实的请求可以直接回答，不强制调用 `campus_search`；

重复 Activity 投递受 execution-control 的 invocation receipt 约束。供应商调用已经开始但完整结果
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

Agent Runtime 在创建真实 `AgentInputItem[]` 时组装：

- 已裁剪的近期完整会话片段；
- 存在已确认值时的有界会话状态；
- 本轮工具结果（只在工具实际执行后出现）；
- 当前用户消息。

当前用户消息只出现一次。字符预算在真实输入数组上计算；超过预算时从最旧处删除完整会话片段，
不保留脱离对应用户问题的 Assistant 消息。Agent Runtime 在结果中返回实际 `context_usage`，
execution-control 不预先构造另一份模型上下文摘要。

用户文本、对话、记忆和工具结果都是不可信数据，不能拼入 developer instruction。匹配的个人记忆只能
支持用户自身事实或偏好，不能被当作机构事实来源。`campus_search` 结果作为本轮函数工具结果进入 SDK
上下文；来源公开字段由 execution-control 在 Finalization 中从真实函数工具结果派生。hosted
`web_search` 结果由 SDK 直接提供给同一次 run；Finalization 校验 SDK 原生引用并派生 `web_page`
来源卡。Web Search 不进入本地 `tool_results` 或工具轨迹，也不保存供应商原始搜索结果。

Agent 根据问题所需事实与工具声明范围选择工具，不按机构、地点或其他实体名称建立固定路由。已发布
Campus Docs 可以使用 `campus_search`，需要补充或核验尚未采集的公开校园网页信息时可以使用
`web_search`；后者不是前者失败后由代码机械触发的回退。问题同时包含已覆盖和未覆盖事实时，只回答
本轮成功 evidence 支持的部分并说明资料边界；已有有效部分答案时仍生成普通正文。所需机构事实完全
没有本轮成功 evidence 支持时直接说明资料不足。普通函数工具失败可以与合法答案并存，但失败结果
不得成为答案依据；合同、
身份、运行指纹和结果结构错误继续失败关闭。

## 输出与终态

Agent Runtime 使用 Agents SDK 原生文本输出，返回非空 `final_output`、有序真实函数工具调用摘要、模型
用量、`context_usage`、运行指纹和 trace 关联。hosted `web_search` 的原生 URL citation 随终态结果返回，
不伪装成本地函数调用；execution-control 校验引用位置和来源后，将其转换为正文中的统一来源链接。
最终响应使用 `execution_finalization_response_v8`；追问、资料不足和范围说明都作为 `completed` 正文保存。

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
