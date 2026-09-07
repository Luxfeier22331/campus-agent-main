---
doc_type: architecture
owner_boundary: agent-retrieval
status: active
---

# Agent 的机构知识边界

本文定义当前在线 Agent 与机构知识数据之间的边界。系统只有一个 Primary Agent；机构知识通过
已注册的只读 `campus_search` function tool 按需查询，不恢复 Knowledge Agent、handoff、强制预检索
或第二次答案合成。

`campus_search` 的工具说明声明它提供中央民族大学当前 Campus Web 文档和已发布校园通知。Primary Agent 根据问题
所需事实与该声明范围是否相交决定是否调用；问候、改写、个人事实以及所需事实完全不在该范围内的
请求，不因词面相似而自动查询 Campus RAG。工具调用时读取 PostgreSQL
`campus_docs_serving.current_index` 的当前 collection，并从 Model Config 读取当前
`campus_docs_embedding` 与 `campus_docs_reranker` 连接；collection、provider 和检索参数不进入准入快照
或 Temporal workflow input。

检索只保留 rerank `relevance_score >= 0.5` 的候选，每次返回最多 5 条，同一 run 累计最多 10 条；
没有候选时返回 `no_match`。该分数只表示查询与候选文本的相关性，不判断机构、人群或规则适用主体。
工具返回的 `results` 是供 Agent 选择的候选，不等于答案已经使用。模型只对实际采用的结果使用其
全局 `citation_index` 写入 `[1]` 到 `[10]`；execution-control 在 Finalization 时从引用和真实工具
结果派生公开 source cards。未知或越界引用使 Finalization 失败。模型不能自行创建来源，也不能把
`result_ref` 写入答案。

未明确指定机构时，学校、本校和校园默认指中央民族大学。问题包含多个事实范围时，Agent 可以调用
能够覆盖其中一部分的工具，只回答本轮候选直接支持的部分并说明剩余资料边界；已有部分答案时
仍返回普通正文，不能因另一部分没有资料而丢弃有效答案。所需机构事实完全没有本轮候选
支持时在正文中说明当前资料无法支持回答，而不是用模型记忆补全。

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
