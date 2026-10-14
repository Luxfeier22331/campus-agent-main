# Agent Note: 单一 Agent 与机构知识边界

Status: implemented

## 背景

ADR-0075 曾把机构知识查询包装为 Primary Agent 到 Knowledge Agent 的 handoff。后续实现保留同一模型
角色，但又把 Campus Docs 检索固化为每个有效请求都必须执行的 Temporal Activity，并把检索结果固定注入
模型输入。

这条链路不是通用 RAG 或工具合同。它让问候、改写和个人事实请求也依赖 Qdrant 与 Embedding
Provider，并使 Agent 输入、Temporal history、运行投影、评测和部署配置同时耦合到 Campus Docs。
当前产品已经确定已发布 Campus Docs 以 Agent Workflow Solve/Executor 的只读 `campus_search` function tool 接入；
尚未采集的公开校园网页信息可由供应商原生 `web_search` 补充。本笔记记录收敛后的本地知识边界，
避免恢复强制预检索或多 Agent 编排。

早期 ADR-0007 选择 hybrid retrieval，是因为规章、培养方案的精确术语、条款编号和固定名称
不能只依赖 dense 相似度；使用 Qdrant 原生 dense/sparse prefetch 与 RRF，避免维护第二套稀疏评分
引擎。该理由仍适用于当前 `campus_search`，与是否在每次请求前强制检索是两个独立决定。

## 当前适用范围

[Agent 编排与 Memory 独立服务](./2026-10-10-agent-orchestration-memory-services.md)取代本文早期由 execution-control 调用工具和推进 operation
的所有权；当前模型与工具 Activity 均由 Runtime Workflow 编排。按需检索、来源校验和不强制预检索
的决定继续有效。

## 决策

- 在线回答由同一模型角色执行当前所需的 operation；Solve 可以按需检索并直接回答，或返回计划。
  计划路径逐步 Execute、按条件 Replan，最后 Synthesize；直接答案不再经过计划合成。这样让简单问题
  在 Solve 内完成，同时保留复杂任务的显式依赖与剩余路径调整，不恢复 Knowledge Agent 或 handoff；
- 当前在线 workflow 不自动执行 Campus Docs 检索，也不向 Agent Runtime 注入固定
  `campus_docs_evidence`；
- Solve 使用准入工具，Executor 使用当前步骤允许的来源，按需调用只读 `campus_search`；Finalization 只接受同一次运行中成功工具经对应
  adapter 校验的来源引用；
- 模型配置启用托管搜索时，Solve 可以使用 `web_search`，Executor 还要求当前步骤的候选来源显式允许。
  它只用于校园问题的公开网页证据，不进入本地函数工具预算、结果或轨迹，也不是
  `campus_search` 失败后的代码级 fallback；
- `campus_search` 由 agent-runtime 通过 HTTP 调用 Campus Search service，后者读取当前 collection
  及 embedding/reranker 连接；这些读取目标不放入 admission snapshot 或 Temporal workflow input。
  agent-control 在首次合法搜索响应后绑定 collection，并拒绝后续不同 collection 的结果，
  不通过该绑定让搜索服务改查旧索引；
- Campus Docs/Notice 的来源、Chunk、Embedding、统一 Qdrant collection 和发布器继续作为独立离线数据面维护；
  离线索引或当前绑定存在不表示在线 Agent 已经消费它；
- Docs/Notice builder 分别完成 Chunk 与 Embedding 阶段，统一 Publisher 只接收两套显式内容寻址制品并
  原子更新当前绑定；Publisher 不重新 embedding；
- 个人记忆只支持用户自身事实或偏好，不能替代机构知识来源；
- 本地函数工具调用次数只受当前 operation 的总 `max_function_tool_calls` 限制；`max_plan_steps` 和
  `max_replans` 由外层 workflow 约束。Solve/Executor 决定当前已开放来源的使用，Replanner 决定剩余
  步骤及其来源；模型决策与 Temporal 持久推进分属内外两层，不恢复代码级 fallback、Knowledge Agent 或 handoff。

### 检索定义与运行合同

索引定义固定 embedding 空间、维度、vector name 与 sparse 算法，发布器和查询 adapter 必须一致；
供应商默认值不能静默决定维度。检索调优通过代码定义、索引重建和相应验证完成，不把 collection、
vector name 或结果预算交给模型输入。执行侧只返回经过校验的有界 DTO，原始存储 payload 不越过
运行时合同；主题集合也不等于多个物理检索 collection。

## 未采用方案

- **保留强制检索但允许空结果**：仍让全部请求依赖尚未完成的知识架构；
- **只停止 Activity、保留 evidence 字段和 Qdrant 配置**：会形成没有消费者的兼容面；
- **强制每次请求预检索**：会让问候、改写和个人事实请求依赖 Qdrant 与 Embedding Provider。

## 后果

- agent-control 不在准入阶段冻结 Qdrant、Embedding 设置或当前索引绑定；Campus Search service
  在工具调用时读取当前配置。索引发布切换可能使同一 run 的后续检索因 collection 不一致而被拒绝；
- Agent Runtime 输入和 Temporal workflow 只保留当前实际开放的能力；
- 在线 Agent 评测不再把机构文档证据当作固定输入，离线 RAG 评测继续验证索引制品；
- `campus_search` 返回 `no_match` 或失败时，在线回答不能使用模型记忆补全机构事实；系统不会由代码
  自动触发 Web Search。模型可以继续使用当前已开放的来源，Replanner 可以在符合条件且有预算时
  调整后续步骤；
- 来源与引用的结构校验不判断每条结论是否被材料支持；该语义要求由模型指令和答案评测承担，
  不能把无引用的合法追问或资料不足说明判为运行失败；
- 删除旧类型、阶段耗时、部署变量和兼容路径，不保留隐藏 fallback。

### 早期检索范围的变化

旧 ADR 当时未默认启用 reranking、HyDE、multi-query expansion 或自动 query rewriting，要求先有
具体评测或运行缺口再引入。当前在线路径已使用 hybrid RRF 加 reranker，因此“不默认重排”仅是
历史选择，不再是当前约束；旧 ADR 本身没有记录后续引入重排的评测结论，不能据此补造验证结果。
当前查询、失败语义及预算由[检索服务](../../../../docs/architecture/system/retrieval-serving.md#在线消费边界)
维护，不保留本地稀疏检索回退或失败时静默切换另一条查询路径。

## 相关文档

- [Agent 框架](../../../../docs/architecture/system/agent-framework.md)
- [Agent 的机构知识边界](../../../../docs/architecture/system/agentic-retrieval.md)
- [检索服务](../../../../docs/architecture/system/retrieval-serving.md)
- 部分取代 [规范化通知存储](./2026-08-14-normalized-notice-storage.md)当时不提供 Notice RAG 的范围；通知内容所有权继续由该篇维护。

后续 Agent Workflow 将 [早期 Temporal 单次 SDK run 范围](./2026-06-06-temporal.md)与
[仅原生文本的输入输出范围](./2026-07-16-agent-io.md)扩展为多 operation；
当前持久执行、模型/工具 Activity 和最终来源校验的所有权由编排拆分决策及各自合同维护。
