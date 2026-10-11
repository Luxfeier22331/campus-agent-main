---
doc_type: architecture
owner_boundary: agent-retrieval
status: active
---

# Agent 的机构知识边界

本文定义当前在线 Agent 与机构知识数据之间的边界。机构知识由同一 Agent Workflow 的 Solve 或 Executor
通过只读 `campus_search` function tool 按需查询，不使用 Knowledge Agent、handoff 或强制预检索。
直接回答与计划合成的分支由[Agent 框架](./agent-framework.md#运行形态)维护，Finalization 不额外调用模型改写答案。

`campus_search` 的工具说明声明它提供中央民族大学当前 Campus Web 文档和已发布校园通知。Primary Agent 根据问题
所需事实与该声明范围是否相交决定是否调用；问候、改写、个人事实以及所需事实完全不在该范围内的
请求，不因词面相似而自动查询 Campus RAG。工具调用时读取 PostgreSQL
`campus_docs_serving.current_index` 的当前 collection，并从 Model Config 读取当前
`campus_docs_embedding` 与 `campus_docs_reranker` 连接；collection、provider 和检索参数不进入准入快照
或 Temporal workflow input。agent-control 在首次合法响应后绑定 run 的 collection，后续响应须匹配；
完整读取与绑定时序见[检索服务](./retrieval-serving.md#在线消费边界)。

查询 Embedding 使用检索适配器持有的进程内精确 LRU：最多 512 条，从成功加载起保留 24 小时，
进程重启即清空。键由缓存版本、provider、规范化 Base URL、model、dimensions、instruction version
及完整实际 Embedding 输入组成并计算 SHA-256；不做额外空白归一化或语义匹配，不包含 API key、
collection 或 rerank query。每次调用先解析当前 Model Config，换模型、端点或输入会自然 miss，
同向量空间的凭据轮换不失效缓存。仅保存维度正确且有限的成功向量，返回副本；错误不缓存。
同键并发共享一次上游请求，每个等待者可独立取消；所有等待者退出或 20 秒上游期限到达后停止请求。
缓存关闭时直接调用 provider。每次检索仍读取当前索引、执行 Qdrant 和 rerank，不缓存召回结果或答案。

缓存由 `internal/embedding` 拥有，不引入 Execution Control/Temporal 持久状态或 Redis。
现有 JSON 日志通过 `campus_docs.embedding.cache.hit/miss/wait/eviction` 的 `event_type` 计数，
hit 的 `saved_ms` 以首次加载耗时估算避免的上游延迟；不记录原始 query、缓存键、向量或凭据。
当前进程没有 metric exporter，因此直接复用日志出口，不注册无消费者的 OTel counter。
Ops 现有 `embedding/retrieval/rerank/selection` 阶段语义不变，Embedding 耗时包括配置读取和缓存等待。
该缓存只缓解重复查询的上游延迟；若未来检索服务已有等价共享缓存，在迁移时重新评估或移除这一层。

召回使用工具提供的搜索表达，rerank 使用本次检索要补足的 `search_goal`，旧调用未提供时使用用户目标。Ops 的现有
诊断分别记录实际召回查询和排序目标；历史记录未保存排序目标时显示未记录，不回填推断值。

检索只保留 rerank `relevance_score >= 0.5` 的候选，每次返回最多 5 条；
没有候选时返回 `no_match`。该分数只表示查询与候选文本的相关性，不判断机构、人群或规则适用主体。
工具返回的 `results` 是供 Agent 选择的候选，不等于答案已经使用。模型只对实际采用的结果使用其
全局递增的 `citation_index` 写入 `[n]`；agent-control 在 Finalization 时从引用和真实工具
结果派生公开 source cards。未知或越界引用使 Finalization 失败。模型不能自行创建来源，也不能把
`result_ref` 写入答案。

未明确指定机构时，学校、本校和校园默认指中央民族大学。问题包含多个事实范围时，Agent 可以调用
能够覆盖其中一部分的工具，只回答本轮候选直接支持的部分并生成普通正文，不能因另一部分没有资料而丢弃有效答案。
所需机构事实完全没有本轮候选支持时，只能使用简洁的“暂未找到相关资料”或“目前无法确认”，不得用模型记忆补全，
也不得向用户解释内部资料范围。

候选存在与否不决定回答模式：正常搜索出口统一进入综合回答，由 Synthesizer 判断材料能回答什么。
Workflow 只区分有材料或来源成功与无材料且没有成功来源的技术失败，不删除无用候选或伪造 `no_match`。

Campus Docs/Notice 的来源清洗、reader、Chunk、Embedding 和统一 Publisher 仍属于独立离线数据面，由
[检索服务](retrieval-serving.md) 维护。离线索引或当前指针只表示可供工具查询的制品已经发布，
不改变 Agent 的准入能力。

Agents SDK 原生 `web_search` 可以为校园问题补充或核验尚未进入 Campus Docs 的公开网页信息，但它
不属于本地检索数据面，也不是 `campus_search` no-match 或失败后的代码级 fallback。其原生引用由
Finalization 校验并转换为正文中的编号来源链接与 `web_page` source card；Web Search 不进入
本地 `tool_results` 或工具轨迹，也不保存供应商原始搜索结果。

## 相关文档

- [Agent 框架](agent-framework.md)
- [工具路由](tool-routing.md)
- [检索服务](retrieval-serving.md)
- [执行合同](../../contracts/tool-execution.md)
- [实体别名](../../../.agents/notes/implemented/architecture/2026-07-16-entity-aliases.md)
