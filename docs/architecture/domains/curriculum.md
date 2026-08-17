---
doc_type: architecture
owner_boundary: domains/curriculum
status: active
---

# 培养方案

## 边界

培养方案领域维护专业培养方案的版本化正文、章节和表格结构。培养方案仍是文档，不维护独立课程
事实读取模型，也不拥有在线查询范围或专用 Qdrant collection。

公开阅读发布使用三个独立集合：
`curriculum/undergraduate`、`curriculum/second_degree` 和 `curriculum/general_education`，分别
承载本科培养方案、二学位培养方案和通识教育文档。

## 数据流

```text
已核对的培养方案来源
-> campus_docs_source.v3 + campus_docs_reader.v3
-> Campus Web 静态文档
-> Campus Docs index publisher
-> 共享的不可变 campus_docs 索引
```

`configs/ingestion/curriculum/curriculum_plan/` 中的 split manifest、chunk profile 和合成样例属于
独立 ingestion 数据面，不被当前 Campus Docs publisher 消费。源码具备 publisher 不表示任一环境
已经激活索引；实际可用性取决于 `campus_docs_serving.current_index` 是否存在有效的当前查询绑定。

## 读取边界

- Primary Agent 不获得培养方案专用工具；
- 文档阅读器按公开集合、规范文档、版本和章节提供固定链接；
- 来源清单在发布前明确记录每份文档属于哪一个公开集合，文档构建和索引发布都不按标题猜测归类；
- 在线请求不扫描原始文件、私有 artifact 或未发布派生集合。

`configs/ingestion/curriculum/` 只维护所属离线任务配置，不决定 Campus Docs 在线准入。

## 相关文档

- `../system/agentic-retrieval.md`
- `../system/retrieval-serving.md`
- `../system/document-site.md`
- `../../data/document-reader.md`
