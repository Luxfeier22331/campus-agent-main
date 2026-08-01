---
doc_type: architecture
owner_boundary: domains/curriculum
status: active
---

# 培养方案

## 边界

培养方案领域维护专业培养方案的版本化正文、章节和表格结构。当前文档范围名为 `curriculum`，逻辑
collection 为 `curriculum_plan`。

培养方案当前仍是文档，不维护独立课程事实读取模型。当前没有正式索引生产者和可供准入的发布数据，
不得把公开文档页面推导为在线问答能力。

公开阅读发布使用三个独立集合：
`curriculum/undergraduate`、`curriculum/second_degree` 和 `curriculum/general_education`，分别
承载本科培养方案、二学位培养方案和通识教育文档。

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
- 文档阅读器按公开集合、规范文档、版本和章节提供固定链接；
- 来源清单在发布前明确记录每份文档属于哪一个公开集合，发布任务不按标题猜测归类；
- 在线请求不扫描原始文件、私有 artifact 或未发布派生集合。

范围映射与本地路由词由 `configs/runtime/query-serving-targets.v3.json` 维护，集合配置由
`configs/ingestion/curriculum/` 维护。

## 相关文档

- `../system/agentic-retrieval.md`
- `../system/retrieval-serving.md`
- `../system/document-site.md`
- `../../data/document-reader.md`
