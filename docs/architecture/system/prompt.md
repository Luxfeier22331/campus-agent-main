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

代码负责认证、授权、工具与知识目标准入、期限、输出 schema、依据校验和终态写入。Agents SDK
在这些边界内负责语义选择、handoff、工具循环、澄清和答案生成。提示词不能替代代码检查，也
不能扩大当前 run 已提供的能力。

## 指令层次

模型输入按以下职责分层：

1. 仓库级稳定边界；
2. Primary Agent 或 Knowledge Agent 的角色指令；
3. execution-control 提供的有界运行上下文；
4. 当前用户输入和近期会话；
5. 工具返回的有界数据与依据；
6. 严格结构化输出要求。

角色指令由 `apps/agent-runtime` 维护。execution-control 传入类型化数据，不在 Go 侧维护另一套
Agent prompt 或答案合成 prompt。

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

当前用户消息只出现一次。近期对话、记忆、工具结果和依据按多轮上下文规则裁剪，并保持来源
类别。模型输出必须满足可执行 schema；execution-control 可以拒绝无效终态和依据引用，但不
调用第二个模型改写答案。

具体上下文行为见 `../../product/run-context.md`，Agent 输入输出见 `agent-framework.md`，终态
合同见 `../../contracts/tool-execution.md`。

## 可观测性

有界产品投影只保存 prompt 标识、模板与渲染 hash、模型身份、终态分类和关联标识。受信任
Langfuse trace 可以按合同记录真实模型输入输出；普通产品投影、Axiom 和 Sentry 不复制这些
正文。请求不能动态开启或关闭遥测。

## 变更验证

Prompt 或模型输入输出变化应验证：

- 输入变量完整且输出满足 schema；
- 工具、权限和知识目标边界没有被 prompt 绕过；
- 澄清、拒绝、依据不足和依赖不可用保持可区分；
- 相关 Agent 与 RAG 数据集没有出现不可接受回归。

具体评测方法和发布流程分别见 `../../reference/eval.md` 与所属操作手册。

## 相关文档

- `agent-framework.md`
- `tool-routing.md`
- `agentic-retrieval.md`
- `retrieval-serving.md`
- `langfuse.md`
- `../../decisions/adr-0060-agent-io.md`
