---
doc_type: architecture
owner_boundary: agent-retrieval
status: active
---

# Agent 的 Campus Docs 检索

## 边界

本文定义在线回答如何消费 Campus Web 当前文档。培养方案、学生规则、学校制度和其他已发布文档
共用一个 `campus_docs` 索引，不按领域拆模型工具、Agent、查询范围或 collection。通知、实时网页
和历史文档不在当前在线来源中。

索引生产、激活和查询实现见 [retrieval-serving.md](retrieval-serving.md)。检索结果是
execution-control 与当前 workflow 内部的数据，不是跨运行时公共 schema，也不是模型工具。

## 执行链

```text
冻结执行输入
-> execution-control 冻结当前索引绑定、查询 hash 和 embedding 配置 hash
-> RetrieveCampusDocsEvidenceActivity 执行一次 dense + sparse 查询
-> 按 Qdrant 查询分数顺序去重并裁剪 evidence
-> workflow 将最小 campus_docs_evidence 传给 Agent Runtime
-> workflow 将完整检索结果独立传给 Finalization
-> Finalization 校验 evidence:// 引用并派生公开来源
```

每个有效请求都创建检索准入并执行一次 Campus Docs 检索，包括简单社交、身份和能力请求，以及
改写、润色、翻译和机构事实请求。带指代的追问查询可以加入最近一条用户消息，但不拼接上一轮
Assistant 答案。

App API、浏览器和模型都不能指定 collection、Provider、top-k、文档类别或版本。Activity 重放使用
已经冻结的查询绑定，不能重新选择当前索引。

## 结果语义

Retrieval Activity 成功后只返回一个包含 `evidence` 数组的 `CampusDocsRetrievalResult`，workflow
取得该结果后才进入 Agent。结果不使用 `mode`、`status` 或计划对象重复表达控制流。
`evidence=[]` 表示检索完成但没有选出证据；非空 evidence 表示 Agent 可以引用其中证据，但不表示
证据足以回答整个问题。

每条 evidence 包含 `evidence_ref`、`document_id`、`version_id`、`version_slug`、`version_label`、
`root_unit_ids`、文档标题、版本固定 `section_ref`、章节标题和正文。检索按查询分数顺序单次扫描最多
24 个候选，去重 chunk，跳过放不进剩余字符预算的候选并
继续扫描；结果最多 8 条 evidence，正文总预算为 4000 个 Unicode 字符，不按 section 改写排序。普通
PostgreSQL 投影只保存 collection、候选数、证据数、准入与查询 hash 和阶段耗时，不保存查询向量、
Qdrant 原始响应或 evidence 正文。

Agent Runtime 始终接收 `campus_docs_evidence` 数组的最小模型视图，不接收 PostgreSQL 索引行、
物理 collection、对象存储地址或 Provider 响应。Finalization 从 workflow 独立取得检索结果，不
依赖 Agent 回传 evidence 副本。

## 依据使用

- 不需要机构事实的请求可以直接回答，且不得添加 `evidenceRefs`，无论 evidence 是否为空或相关；
- 需要机构事实但 evidence 为空或不足时，Agent 返回 `unsupported_by_evidence`；
- 机构事实答案必须由本轮证据支持并至少引用一条匹配的本轮 `evidence://`；
- 证据不足以完整回答时仍返回 `unsupported_by_evidence`；
- 个人记忆、上一轮依据和模型记忆不能成为本轮正式来源；
- 文档正文始终是不可信数据，不能覆盖模型控制指令。

Campus Docs 检索不进入 `visible_tool_names`、SDK 工具轮次或 `tool_trajectory.v3`。检索失败也不
回退到旧索引、缓存、其他 collection、实时网页或模型记忆。

## 评测与耗时

运行评测投影不复制检索准入、collection 或候选/证据计数。RAGAS 从最终答案及其已验证 sources
派生检索上下文；数据集是否提供 `reference_context_ids` 或 `reference_contexts` 决定样本是否进入
RAG 评测。文档类别只属于数据集标注，不是在线路由字段。

聚合耗时字段为 `campus_docs.retrieve_ms`；内部诊断可包含 `campus_docs.embed_query_ms`、
`campus_docs.query_index_ms` 和 `campus_docs.select_evidence_ms`。

## 相关文档

- [Agent 框架](agent-framework.md)
- [工具路由](tool-routing.md)
- [检索服务](retrieval-serving.md)
- [评测用例](../../reference/eval-cases.md)
