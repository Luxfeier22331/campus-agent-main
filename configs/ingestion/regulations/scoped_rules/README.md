# scoped_rules 配置

本目录保存年度周期和限时适用规则采集任务使用的规范化、分块和任务配置。它是独立的
ingestion 配置，当前 Campus Docs publisher 不读取本目录来生成在线索引。稳定校级规章属于
`institutional_rules`，来源通知仍属于对应通知集合。

## 文件

- `canonical-profile.json`：规则身份、适用范围和来源字段；
- `chunk-profile.json`：分块规则；
- `task-registry.v3.json`：本目录可执行的采集任务。

本目录文件存在不会写入 Qdrant 或切换 Campus Docs 当前指针。当前在线索引只由 Campus Web 的
`campus-docs/source.json` 和其引用的 `campus_docs_reader.v3` 生成。规则语义见
`docs/decisions/adr-0037-scoped-rules.md`，来源提升边界见 `docs/decisions/adr-0035-regulation-promotion.md`。
