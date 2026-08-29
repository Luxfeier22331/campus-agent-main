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

当前注册表中的 model-visible 工具为 `campus_search` 和 `personal_memory_recall`。二者都是只读
function tool；注册表、handler 和内部可用性字段的存在不会单独开放工具，execution-control 根据
准入时的可用性决定本轮工具集合。
模型可见的工具名称保持代码标识，description 与参数说明使用简体中文。`campus_search` 的 description
明确其唯一机构范围是中央民族大学当前 Campus Web 文档。

`visible_tool_names` 表示本轮工具集合，数组顺序没有路由语义；准入校验要求名称唯一并按集合核对。
当前集合始终包含 `campus_search`，个人记忆可用时还包含 `personal_memory_recall`。模型是否调用以及
调用顺序由 Primary Agent 根据问题所需事实和工具声明范围决定。系统没有客户端指定工具、Knowledge
Agent、handoff 或文档类别路由。

## 职责

- app-api 负责身份、会话和产品传输，不接收客户端指定的工具、索引或检索参数；
- execution-control 根据注册表和冻结准入策略确定模型可见工具，并执行工具 handler；
- OpenAI Agents SDK 只在已开放工具中决定是否调用，并依据函数 schema 验证模型生成的参数；
- handler 负责运行身份、业务前置条件和结果合同，不重复实现同一份 SDK 函数 schema 校验；
- finalization 校验真实工具投影与依据引用，不重新选择工具或改写答案。

工具准入只能缩小能力，不能改变用户权限、开放关闭工具或选择 Provider。离线 Campus Docs 制品
发布由 `retrieval-serving.md` 维护，不属于当前在线工具路由。

## 执行方式

Primary Agent 消费对话并生成原生文本回答。问题所需事实落在中央民族大学当前 Campus Web 文档
范围时可以调用 `campus_search`；问题依赖用户自身事实或偏好时可以调用
`personal_memory_recall`。工具在同一次 SDK run 内没有单独的每工具调用上限，调用次数只受本轮总
`max_tool_calls` 限制，彼此没有固定先后关系。实体名称
本身不决定路由；模型比较问题所需事实和每个工具声明的事实范围。
`campus_search` 的 no-match 是成功的有界结果，不等于机构事实不存在；模型应在正文中说明资料不足，
或在用户意图不明确时提出简短追问，而不是使用模型记忆补全。

`campus_search` handler 在调用时读取当前 Campus Docs collection，并从 Model Config 读取当前
embedding 和 reranker 连接，执行 dense/sparse hybrid 查询并只返回有界 evidence。它不接收 collection、
provider、top-k 或向量参数。
正文中的 `[1]` 到 `[5]` 只对应本次成功工具结果中按顺序返回的 evidence。

`execution_control_internal_query` handler 在同一个 Agent Activity 内调用 execution-control 的有界
读取接口。个人记忆 handler 重新校验冻结策略和运行身份后调用 Hindsight，只向 Agent 返回受限结果；
它不创建额外 Temporal Activity，也不把记忆正文写入普通投影。

普通工具失败不得贡献 evidence，也不得回退到未注册数据源、强制预检索或旧工具；其他成功工具或
非机构事实已经足以支持回答时，整轮仍可完成。合同、身份、运行指纹或结果结构错误继续失败关闭。

## 投影

真实 SDK 函数调用按发生顺序形成 `tool_trajectory.v4`。重复调用也按实际发生顺序分别记录。轨迹只包含当前工具词汇、状态、耗时和安全
摘要；非工具的未来能力不会被伪装成工具调用。

原始模型参数、记忆正文、凭据和后端响应不得进入产品投影。最终回答的来源校验必须由实际提供该
来源的能力合同决定，不能从工具调用数量推断。

## 禁止形态

- 由浏览器或 app-api 选择工具、索引、collection 或检索参数；
- 把非工具能力伪装成 SDK tool call 或 `eval_safe_args`；
- 为每个 SDK 工具创建 Temporal Activity 或专用队列；
- 在 SDK 终态之后启动第二次规划、反思或答案改写；
- 工具失败时回退到未注册供应商搜索、旧工具或现场采集。

## 相关文档

- `agent-framework.md`
- `agentic-retrieval.md`
- `retrieval-serving.md`
- `../../contracts/tool-execution.md`
- `../../contracts/tool-trajectory.md`
