# curriculum_plan 配置

本目录保存培养方案的逻辑文档边界、分块、检索和采集任务配置。

## 文件

- `split-manifest.v1.json`：公开合成逻辑文档边界；
- `chunk-profile.json`：章节和表格分块规则；
- `query-planning.json`、`retrieval-profile.json`：查询和检索配置；
- `serving-config.json`：索引与查询兼容配置；
- `task-registry.v3.json`：本目录可执行的采集任务；
- `samples/`：公开合成的规范文档样例。

文档范围名称、开放状态、路由词和逻辑映射由 `configs/runtime/query-serving-targets.v3.json` 维护。字段和
任务以本目录 JSON、所属 schema 及测试为准，不在 README 复制。

`curriculum_plan` 是知识检索使用的聚合集合。公开文档站不直接把它作为页面集合；文档发布来源
必须将文档明确分配到 `undergraduate`、`second_degree` 或 `general_education` 之一，并写入
`campus_docs_source.v3`。Campus Web 从该归属生成公开阅读路径；分配不通过标题匹配推断，也不改变
本目录的检索分块和查询目标。

领域边界见 `docs/architecture/domains/curriculum.md`，采集与在线查询边界见
`docs/architecture/system/retrieval-serving.md`。
