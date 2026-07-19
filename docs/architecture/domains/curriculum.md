---
doc_type: architecture
owner_boundary: domains/curriculum
status: active
---
# 培养方案

## 边界

培养方案领域维护专业培养方案的版本化正文、章节和表格结构，支持专业要求、学期课程和培养环节等
有学校依据的问题。

当前模型可见目标名为 `curriculum`，映射到物理集合 `curriculum/curriculum_plan`。课程、专业族和
学期派生事实用于领域检索与解析，不作为独立模型工具或独立查询目标开放。

## 数据流

```text
已核对的培养方案来源
-> 规范文档单元与版本
-> ingestion-control / Rust 内核校验与结构化分块
-> 索引与 release
-> curriculum 查询目标
-> Knowledge Agent 与文档阅读器
```

仓库中的 split manifest 和 sample 是合成测试数据。当前集合任务从已经物化的规范文档单元开始，
不负责来源下载、PDF 解析、索引发布或 alias 切换；这些步骤存在并完成后才能更新在线 release。

## 读取边界

- Knowledge Agent 只查询注册表准入并已发布的 `curriculum` 目标；
- 文档阅读器按规范文档、版本和章节提供固定链接；
- 历史版本只有在明确请求历史或比较时参与检索；
- 在线请求不扫描原始文件、私有 artifact 或未发布派生集合。

目标映射由 `configs/runtime/query-serving-targets.v1.json` 维护，集合配置由
`configs/ingestion/curriculum/` 维护。

## 相关文档

- `../system/retrieval-serving.md`
- `../system/document-site.md`
- `../../data/document-reader.md`
- `../../decisions/adr-0014-document-history.md`
