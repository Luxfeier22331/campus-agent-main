# institutional_rules 配置

本目录保存校级长期规章采集任务使用的规范化、分块和任务配置。它是独立的 ingestion
配置，当前 Campus Docs publisher 不读取本目录来生成在线索引。

## 文件

- `canonical-profile.json`：文档身份与来源字段；
- `chunk-profile.json`：分块规则；
- `task-registry.v3.json`：本目录可执行的采集任务。

任务能力以 `task-registry.v3.json` 为准，README 不复制状态、任务清单或字段定义。目录配置不写入
Qdrant 或切换当前指针；当前在线 Campus Docs 索引只由 Campus Web 的 `campus-docs/source.json` 和其引用的
`campus_docs_reader.v3` 生成。

领域边界见 `docs/architecture/domains/regulations.md`，规章身份见
`docs/decisions/adr-0040-regulation-identity.md`。
