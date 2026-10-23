---
doc_type: architecture
owner_boundary: tool-routing
status: active
---

# 工具路由

## 文档边界

本文定义模型工具如何开放、由谁选择以及如何投影。精确名称、暴露范围、schema、handler 和
timeout 由以下可执行注册表维护：

- `configs/runtime/tools.v8.json`；
- `configs/runtime/tool-function-schemas.v4.json`。

注册表、endpoint 或实现存在都不会自动向模型开放工具。

## 当前状态

当前注册表中的 model-visible 工具为 `campus_search` 和 `personal_memory_recall`。二者都是只读
function tool；注册表、handler 和内部可用性字段的存在不会单独开放工具，agent-control 根据
准入时的可用性决定本轮工具集合。
模型可见的工具名称保持代码标识，description 与参数说明使用简体中文。`campus_search` 的 description
明确其机构范围是中央民族大学当前 Campus Web 文档与已发布通知。

`visible_function_tool_names` 表示本轮工具集合，数组顺序没有路由语义；准入校验要求名称唯一并按集合核对。
当前集合始终包含 `campus_search`，个人记忆可用时还包含 `personal_memory_recall`。Solve/Replanner
决定当前步骤的候选来源，Executor 根据问题所需事实、已获得证据和工具声明范围决定实际调用。系统没有
客户端指定工具、Knowledge Agent、handoff 或文档类别路由。

模型配置启用托管搜索时，Agent Runtime 为 Solve 附加供应商原生搜索工具；Executor 还要求当前步骤允许
`web_search`。原生工具为 OpenAI Web Search 或 Gemini Google Search。它不在
`tools.v8.json`、`visible_function_tool_names` 或 agent-control handler 中登记，也不由客户端
选择。它只用于校园问题的公开网页证据。

## 职责

- app-api 负责身份、会话和产品传输，不接收客户端指定的工具、索引或检索参数；
- agent-control 根据注册表和冻结准入策略确定模型可见工具；agent-runtime 的工具 Activity 执行实际调用；
- Solve 可使用准入工具直接检索并回答，也可为计划步骤声明候选来源；Executor 在当前步骤内选择来源，
  Runtime 依据函数 schema 验证模型生成的本地工具参数；
- handler 负责运行身份、业务前置条件和结果合同，不重复实现同一份 SDK 函数 schema 校验；
- Replanner 根据真实结果决定后续步骤和来源；finalization 校验真实工具投影与依据引用，不重新选择
  工具或改写答案。

工具准入只能缩小能力，不能改变用户权限、开放关闭工具或选择 Provider。离线 Campus Docs 制品
发布由 [检索服务](./retrieval-serving.md) 维护，不属于当前在线工具路由。

## 执行方式

Solve、Executor、Replanner 和 Synthesizer 共同完成 Agent Workflow。问题所需事实落在中央民族大学
当前 Campus Web 文档与已发布通知范围时，Solve/Executor 可以调用 `campus_search`；问题依赖用户自身
事实或偏好时可以使用 `personal_memory_recall`；需要补充或核验尚未采集的公开校园网页信息时，可以
使用当前 operation 已开放的 `web_search`。同一 operation 内没有固定工具先后关系，本地函数调用次数受该 operation 的
`max_function_tool_calls` 限制；hosted `web_search` 不占用该本地预算。实体名称本身不决定路由；步骤
和模型只比较用户目标、当前证据与各来源的事实范围。
`campus_search` 的 no-match 是成功的有界结果，不等于机构事实不存在。Solve/Executor 可以在同一
operation 内选择其他已开放来源；Replanner 负责按目标和证据调整剩余步骤及其候选来源。no-match 或
函数工具失败不会由代码自动触发 `web_search`，也不会把失败结果作为答案依据。

`campus_search` Activity 通过内部 HTTP client 调用 Campus Search service；后者读取当前索引、解析
embedding 与 reranker 连接并执行查询，Runtime 与 Control 共同完成运行校验和结果投影，Workflow 保持 citation 的确定顺序。读取和绑定时序见
[检索服务](./retrieval-serving.md#在线消费边界)。模型不能指定 collection、provider、top-k 或向量参数。
每次检索最多返回 5 条结果，同一 run 累计最多 10 条；正文中的 `[1]` 到 `[10]` 对应结果携带的
本轮全局 `citation_index`。检索结果只是候选，只有正文实际引用的结果进入公开来源投影。

`personal_memory_recall` 工具 Activity 直接调用 Memory API，Memory 通过访问 fence 调用 Hindsight，
返回有序 `facts` 和 `context_char_budget`。Provider adapter 负责结果数量和单条 UTF-8 字节截断；
Runtime 负责中文标题、完整行预算及 matched/no_match，将其转换为 `outcome` 与 `memory_text`。
每次模型或本地函数调用由独立 Activity 承载，不自动向 prompt 注入记忆。

普通工具失败不得贡献候选或来源，也不得回退到未注册数据源、强制预检索或旧工具；其他成功工具或
非机构事实已经足以支持回答时，整轮仍可完成。合同、身份、运行指纹或结果结构错误继续失败关闭。

## 投影

真实 SDK 函数调用按发生顺序形成 `tool_trajectory.v4`。重复调用也按实际发生顺序分别记录。轨迹只包含
当前本地函数工具词汇、状态、耗时和安全摘要；hosted `web_search` 不进入本地 `tool_results` 或工具
轨迹，也不会被伪装成本地函数调用。

原始模型参数、记忆正文、凭据和后端响应不得进入产品投影。最终回答的来源校验必须由实际提供该
来源的能力合同决定，不能从工具调用数量推断。

## 禁止形态

- 由浏览器或 app-api 选择工具、索引、collection 或检索参数；
- 把非工具能力伪装成 SDK tool call；
- 为每种工具创建独立 Deployment 或专用队列；工具 Activity 共用 Agent tool 队列；
- 绕过 Agent Workflow 直接在 SDK 终态之后启动额外规划、反思或答案改写；
- 函数工具失败时由代码自动回退到 hosted Web Search、未注册供应商搜索、旧工具或现场采集。

## 相关文档

- [Agent 框架](./agent-framework.md)
- [Agent 的机构知识边界](./agentic-retrieval.md)
- [检索服务](./retrieval-serving.md)
- [执行合同](../../contracts/tool-execution.md)
- [工具轨迹合同](../../contracts/tool-trajectory.md)
