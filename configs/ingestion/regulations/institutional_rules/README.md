# institutional_rules 配置

本目录保存校级长期规章的规范化、分块、查询规划和采集任务配置。

## 文件

- `canonical-profile.json`：文档身份与来源字段；
- `chunk-profile.json`：分块规则；
- `query-planning.json`：查询规划提示；
- `serving-config.json`：索引与查询兼容配置；
- `task-registry.v3.json`：本目录可执行的采集任务。

查询目标名称、是否开放及其物理映射只由
`configs/runtime/query-serving-targets.v3.json` 维护。任务能力以 `task-registry.v3.json` 为准，
README 不复制状态、任务清单或字段定义。

领域边界见 `docs/architecture/domains/regulations.md`，规章身份见
`docs/decisions/adr-0040-regulation-identity.md`。
