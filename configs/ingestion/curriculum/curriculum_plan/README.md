# curriculum_plan 配置

本目录保存培养方案采集任务使用的逻辑文档边界、分块和任务配置。它是独立的 ingestion 配置，当前
Campus Docs publisher 不读取本目录来生成在线 Campus Docs 索引。

## 文件

- `split-manifest.v1.json`：公开合成逻辑文档边界；
- `chunk-profile.json`：章节和表格分块规则；
- `task-registry.v3.json`：本目录可执行的采集任务；
- `samples/`：公开合成的规范文档样例。

字段和任务以本目录 JSON、所属 schema 及测试为准，不在 README 复制。

`curriculum_plan` 是采集侧的逻辑聚合集合。公开文档站不直接把它作为页面集合；Campus Web 维护的
`campus-docs/source.json` 才是当前 Campus Docs publisher 的输入清单，publisher 只消费清单引用的
`campus_docs_reader.v3` 正文。本目录的分块产物不会隐式同步或进入在线索引。

领域边界见 `docs/architecture/domains/curriculum.md`，采集与在线查询边界见
`docs/architecture/system/retrieval-serving.md`。
