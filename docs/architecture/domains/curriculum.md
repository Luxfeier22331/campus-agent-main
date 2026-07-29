---
doc_type: architecture
owner_boundary: domains/curriculum
status: active
---

# 培养方案

## 边界

培养方案领域维护专业培养方案的版本化正文、章节和表格结构。当前文档范围名为 `curriculum`，逻辑
collection 为 `curriculum_plan`。

培养方案当前仍是文档，不维护独立课程事实读取模型。专业要求、课程、学期、学分和培养环节等
问题都必须由同一文档 RAG 的当前 release 提供正文依据。

## 数据流

```text
已核对的培养方案来源
-> canonical_document_unit.v2
-> build-retrieval-chunks-v2
-> retrieval_chunk_set.v2

knowledge-serving-release.v1 + PostgreSQL current_releases + Qdrant
-> execution-control grounding 消费接口
```

仓库中的 split manifest 和 sample 是合成测试数据。当前没有把检索分块发布为 release 与 Qdrant
索引的正式生产者，也没有可准入的发布数据，因此 `curriculum` grounding 当前不可用。来源采集和
规范化不会自动开放在线能力。

## 读取边界

- Primary Agent 不获得培养方案专用工具；
- execution-control 只使用准入快照中的当前 `curriculum` release 和物理 Qdrant collection；
- Qdrant chunk 保存正文、token 数和引用 metadata；
- Agent 只能引用本轮 `grounding_context.v2` 中的 `evidence://`；
- 当前在线检索不查询历史培养方案 release；
- 在线请求不扫描原始文件、私有 artifact 或未发布集合。

范围映射与本地路由词由 `configs/runtime/query-serving-targets.v3.json` 维护，集合配置由
`configs/ingestion/curriculum/` 维护。

## 相关文档

- `../system/agentic-retrieval.md`
- `../system/retrieval-serving.md`
- `../system/document-site.md`
- `../../data/document-reader.md`
