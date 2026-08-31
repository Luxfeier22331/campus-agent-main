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

代码负责认证、授权、工具准入、期限、非空文本与工具结果校验以及终态写入。当前代码冻结
`execution_strategy.v4` 的 `direct` 路径；在线回答不自动预检索或注入 Campus Docs 内容，机构知识
可以通过已注册的 `campus_search` function tool 按需提供，也可以由 Agents SDK 原生 `web_search`
补充或核验尚未采集的公开校园网页信息。工具是否存在、如何执行和结果如何公开，必须由对应合同与
实现决定，不能因为提示词中出现相关描述就扩大模型能力。
Agents SDK 在这些边界内负责语义选择、必要的工具循环、澄清和答案生成。提示词不能替代代码检查，
也不能扩大当前 run 已提供的能力。

执行策略不是第二套答案逻辑：它只决定当前已准入的检索和工具预算，不在代码中生成回答或猜测具体
工具参数。当前没有开放审慎检索中的问题分解或迭代路径。

## 指令层次

模型输入按以下职责分层：

1. 仓库级稳定边界；
2. Primary Agent 的角色指令；
3. execution-control 提供的执行策略和有界运行上下文；
4. 当前用户输入和近期会话；
5. 工具返回的有界数据与依据；
6. 回答语言、资料边界和正文引用要求。

角色指令由 `apps/agent-runtime` 维护，并使用简体中文表达当前单校产品边界：Primary Agent 是
中央民族大学校园问答助手，未明确指定机构时，学校、本校和校园均默认指中央民族大学。工具选择依据
问题所需事实与工具声明范围，不使用实体名称级特判；工具结果是候选，正文只引用本轮实际采用的结果。
execution-control 传入类型化数据，不在 Go 侧维护另一套 Agent prompt 或答案合成 prompt。

`campus_search` 返回 `no_match` 或失败时，模型不为同一事实改写查询后重复调用；问题所需事实可从
尚未采集的公开校园网页获取时应使用 `web_search`，不能直接判定资料不足。`web_search` 只服务于校园
问题，不是通用开放域能力，也不是代码自动回退。只有 `campus_search` 成功返回 evidence 时才使用
`[n]` 引用；Web Search 支持的事实必须由 SDK 原生 URL citation 支持，模型不得手写 URL、Markdown
来源链接、数字引用或 turn 引用。Finalization 负责生成统一的编号来源链接。

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
并加入工具结果。Agents SDK 返回原生文本；Agent Runtime 要求非空 `final_output`，execution-control
校验工具结果并从正文引用派生来源，但不调用第二个模型改写答案。

具体上下文行为见 `../../product/run-context.md`，Agent 输入输出见 `agent-framework.md`，终态
合同见 `../../contracts/tool-execution.md`。

## 可观测性

有界产品投影只保存 prompt 标识、模板与渲染 hash、模型身份、运行状态和关联标识。受信任
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

具体评测方法和发布流程分别见 `../../reference/eval.md` 与所属操作手册。

## 相关文档

- `agent-framework.md`
- `tool-routing.md`
- `agentic-retrieval.md`
- `retrieval-serving.md`
- `../../contracts/langfuse-runtime.md`
- `../../decisions/adr-0060-agent-io.md`
- `../../reference/agent-orchestration.md`
