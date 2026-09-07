---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0084
status: accepted
supersedes: ADR-0075
---

# ADR-0084 单一 Agent 与机构知识边界

## 背景

ADR-0075 曾把机构知识查询包装为 Primary Agent 到 Knowledge Agent 的 handoff。后续实现保留同一模型
角色，但又把 Campus Docs 检索固化为每个有效请求都必须执行的 Temporal Activity，并把检索结果固定注入
模型输入。

这条链路不是通用 RAG 或工具合同。它让问候、改写和个人事实请求也依赖 Qdrant 与 Embedding
Provider，并使 Agent 输入、Temporal history、运行投影、评测和部署配置同时耦合到 Campus Docs。
当前产品已经确定已发布 Campus Docs 以 Agent Workflow Executor 的只读 `campus_search` function tool 接入；
尚未采集的公开校园网页信息可由 SDK 原生 `web_search` 补充。本 ADR 记录收敛后的本地知识边界，
避免恢复强制预检索或多 Agent 编排。

## 决策

- 每个在线回答使用同一模型角色完成 `solve`、`execute_step`、`replan` 和 `synthesize` operation；Solve
  可以直接回答或返回计划；不恢复
  Knowledge Agent 或 handoff，但保留显式的计划、重规划和最终合成阶段；
- 当前在线 workflow 不自动执行 Campus Docs 检索，也不向 Agent Runtime 注入固定
  `campus_docs_evidence`；
- Executor 按当前步骤按需调用只读 `campus_search`，Finalization 只接受同一次运行中成功工具经对应
  adapter 校验的来源引用；
- hosted `web_search` 只有在当前 `execute_step` 的候选来源中被 Solve/Replanner 生成的计划显式允许时才由
  Agent Runtime 附加，只用于校园问题的公开网页证据；它不进入本地函数工具预算、结果或轨迹，也不是
  `campus_search` 失败后的代码级 fallback；
- `campus_search` 在 execution-control 中读取当前 collection，并从 Model Config 读取 embedding 和
  reranker 连接，不把二者放入
  admission snapshot 或 Temporal workflow input；
- Campus Docs/Notice 的来源、Chunk、Embedding、统一 Qdrant collection 和发布器继续作为独立离线数据面维护；
  离线索引或当前绑定存在不表示在线 Agent 已经消费它；
- Docs/Notice builder 分别完成 Chunk 与 Embedding 阶段，统一 Publisher 只接收两套显式内容寻址制品并
  原子更新当前绑定；Publisher 不重新 embedding；
- 个人记忆只支持用户自身事实或偏好，不能替代机构知识来源；
- 本地函数工具调用次数只受当前 operation 的总 `max_function_tool_calls` 限制；`max_plan_steps` 和
  `max_replans` 由外层 workflow 约束。来源切换由 Replanner 的结构化剩余步骤决定，不恢复代码级
  fallback、Knowledge Agent 或 handoff。

## 结果

- execution-control 不在准入阶段冻结 Qdrant、Embedding 设置或当前索引绑定；检索 handler 在工具调用
  时读取它们；
- Agent Runtime 输入和 Temporal workflow 只保留当前实际开放的能力；
- 在线 Agent 评测不再把机构文档证据当作固定输入，离线 RAG 评测继续验证索引制品；
- `campus_search` 返回 `no_match` 或失败时，在线回答不能使用模型记忆补全机构事实；系统不会由代码
  自动触发 Web Search，Replanner 可以在仍有预算时生成显式 Web Search 步骤；
- 删除旧类型、阶段耗时、部署变量和兼容路径，不保留隐藏 fallback。

## 未采用方案

- **保留强制检索但允许空结果**：仍让全部请求依赖尚未完成的知识架构；
- **只停止 Activity、保留 evidence 字段和 Qdrant 配置**：会形成没有消费者的兼容面；
- **强制每次请求预检索**：会让问候、改写和个人事实请求依赖 Qdrant 与 Embedding Provider。

## 相关文档

- `../architecture/system/agent-framework.md`
- `../architecture/system/agentic-retrieval.md`
- `../architecture/system/retrieval-serving.md`
- `adr-0007-retrieval-strategy.md`
