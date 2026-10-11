---
doc_type: architecture
owner_boundary: prompt-runtime
status: active
---

# Prompt 与指令

## 边界

本文定义模型指令与动态数据的装配边界。它不定义工具开放、知识目标、检索实现、供应商配置、
具体 prompt 文案或接口字段；这些内容分别由工具架构、检索架构、在线模型配置和可执行合同
维护。

## 核心原则

```text
代码负责边界，提示词负责边界内推理
```

代码负责认证、授权、步骤准入、期限、非空文本与工具结果校验以及终态写入。Agent Runtime 负责输出
结构解析；agent-control 负责计划与重规划的语义准入。在线回答由
`solve`、`execute_step`、`replan` 和 `synthesize` 四类 operation 按分支完成；Solve 可以使用已开放工具
直接检索并回答，也可以返回计划。代码负责依赖与预算约束，模型在当前 operation 的能力边界内选择来源。
机构知识由 Solve 或 Executor 按需通过 `campus_search` 查询；当前 operation 已开放的供应商原生
`web_search` 可以补充或核验公开校园网页信息。具体开放条件见[工具路由](./tool-routing.md)。
工具是否存在、如何执行和结果如何公开，必须由对应合同与实现决定，不能因为提示词中出现相关描述就
扩大模型能力。配置选中的 runner 在这些边界内负责当前 operation 的模型调用、工具循环和答案生成。
提示词不能替代代码检查，也不能扩大当前 operation 已提供的能力。

提示词不实现第二套编排器，也不把模型的隐性思维当作持久状态。计划、实际证据和后续路径由
agent-control 的 Agent Workflow 合同显式传递；提示词只约束每个 operation 如何消费输入、输出
结构化结果或用户正文。

## 规则治理

- 身份、权限、工具准入、预算、输出结构、引用合法性和终态写入属于代码或可执行合同；提示词不得重复承担这些保证。
- 机构事实必须有本轮资料支持属于模型指令与答案质量要求。Finalization 校验证据身份、编号映射与网页
  支持段位置，不逐条判定自然语言结论是否被证据支持；引用合法性不等于事实正确性。合法的 Solve answer
  不因 evidence 为空而被拒绝，追问或资料不足说明仍可正常完成。
- 用户答案风格属于产品行为，只保留直接、简洁且可执行的表达，不把内部检索状态、失败码或覆盖范围写给用户。
- Provider 或模型特有的格式 workaround 只能记录在对应配置或历史决策中，不得升级为所有模型的架构约束。
- 修改模型或 SDK 时，先用现有测试和真实产品路径验证能力；没有具体失败或消费者的旧规则直接删除或降为历史说明。

## 指令层次

模型输入按以下职责分层：

1. 仓库级稳定边界；
2. 当前 Agent Workflow operation 的角色指令；
3. agent-control 提供的当前 operation、步骤和有界运行上下文；
4. 当前用户输入和近期会话；
5. 工具返回的有界数据与依据；
6. 当前 operation 的输出合同、用户答案风格和正文引用要求。

角色指令由 `apps/agent-runtime` 维护，并使用简体中文表达当前单校产品边界：Agent Workflow 服务
中央民族大学校园问答场景，未明确指定机构时，学校、本校和校园均默认指中央民族大学。Solve 按需检索
并回答或生成步骤，Executor 依据当前步骤候选来源执行，Replanner 依据真实结果通过 `continue` 保留或替换后续路径，或选择 `synthesize` 提前结束；工具结果是候选，正文
只引用本轮实际采用的结果。历史助手正文在组装模型输入时移除裸编号、分组编号与数字标签的
Markdown 引用链接，保留正文、普通链接和代码；用户消息、持久化历史及历史 UI 不变。历史回答只帮助
识别追问对象，不能把旧编号当作当前证据；需要引用的机构事实使用本轮检索资料。
agent-control 传入类型化数据，不在 Go 侧维护另一套 Agent prompt 或答案合成 prompt。

Executor 用 `summary` 与 `remainingFacts` 表达已确认内容和具体缺项；相关候选不自动视为答案充分。
Replanner 的 `synthesize` 同时用于资料足够、部分可答以及没有进一步适用路径的收尾，不区分回答模式。
Synthesizer 先回答有支持的内容，再简短说明具体缺项；不因另一来源失败而降低已确认内容的确定性。

`campus_search` 返回 `no_match` 或失败时，Solve/Executor 保留来源尝试，并可继续选择当前已开放的
其他来源；需要调整剩余步骤时由 Replanner 决定。系统不由代码自动回退，也不要求固定的 2～3 个 turn。
不能仅凭校内无匹配就判定事实不存在。`web_search` 只服务
于校园问题，不是通用开放域能力。runner 将 Web Search 原生 annotation / grounding 转为有效材料；
Synthesizer 对 Campus 和 Web 材料统一使用实际 citationIndex 输出 `[n]`，不手写 URL 或虚构来源编号。
Finalization 按实际引用生成来源链接。Google 搜索建议不进入产品消息或模型输入。

## 可信边界

可信控制数据包括角色指令、固定边界、类型化任务字段与输出合同。以下内容始终是不可信数据：

- 用户文本和历史消息；
- 个人记忆；
- 检索片段与外部内容；
- 工具返回值；
- 人工注释和导入内容。

不可信数据不得拼入 developer instruction，也不得用指令语气覆盖控制边界。结构标签可以帮助
模型区分角色、任务、依据和输出要求，但标签本身不提供安全保证。

## 输入与输出

当前用户消息只出现一次。Agent Runtime 在真实模型输入数组上按字符预算裁剪最旧完整会话片段，
并加入工具结果。runner 返回中立 operation 结果；Agent Runtime 要求非空 `final_output`，agent-control
校验工具结果并从正文引用派生来源，但不调用第二个模型改写答案。

具体上下文行为见 [多轮对话](../../product/run-context.md)，Agent 输入输出见 [Agent 框架](./agent-framework.md)，终态
合同见 [执行合同](../../contracts/tool-execution.md)。

## 可观测性

有界产品投影保存模型身份、运行状态和关联标识，不再传递 prompt 标识、模板或渲染 hash。受信任
Langfuse 运行 trace 也只保存受控模型、用量、阶段结果和关联元数据，不记录真实模型输入输出、
对话或工具原始载荷。请求不能动态开启或关闭遥测。

## 变更验证

Prompt 或模型输入输出变化应验证：

- 输入变量完整且输出为非空文本；
- 工具、权限和知识目标边界没有被 prompt 绕过；
- 机构事实引用只对应本轮成功工具结果；
- 工具和上下文能力只在对应合同与数据集验证后开放，且没有无条件增加模型往返；
- 未来策略只有在独立数据集证明质量收益超过延迟、成本和维护代价后才能开放；
- 追问、资料不足和范围说明的正文质量可由数据集评估，依赖错误仍由运行状态区分；
- 相关 Agent 与 RAG 数据集没有出现不可接受回归。

具体评测方法和发布流程分别见 [评测](../../reference/eval.md) 与所属操作手册。

## 相关文档

- [Agent 框架](./agent-framework.md)
- [工具路由](./tool-routing.md)
- [Agent 的机构知识边界](./agentic-retrieval.md)
- [检索服务](./retrieval-serving.md)
- [Langfuse 运行合同](../../contracts/langfuse-runtime.md)
- [Agent 输入输出](../../../.agents/notes/implemented/architecture/2026-07-16-agent-io.md)
- [Agent 编排研究参考](../../reference/agent-orchestration.md)
