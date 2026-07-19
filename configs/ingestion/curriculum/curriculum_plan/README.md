# curriculum_plan 配置

本目录保存培养方案的逻辑文档边界、分块、检索和采集任务配置。

## 文件

- `split-manifest.v1.json`：公开合成逻辑文档边界；
- `chunk-profile.json`：章节和表格分块规则；
- `query-planning.json`、`retrieval-profile.json`：查询和检索配置；
- `serving-config.json`：索引与查询兼容配置；
- `task-registry.v3.json`：本目录可执行的采集任务；
- `samples/`：公开合成的规范文档样例。

查询目标名称、开放状态和物理映射由 `configs/runtime/query-serving-targets.v1.json` 维护。字段和
任务以本目录 JSON、所属 schema 及测试为准，不在 README 复制。

领域边界见 `docs/architecture/domains/curriculum.md`，采集与在线查询边界见
`docs/architecture/system/retrieval-serving.md`。
