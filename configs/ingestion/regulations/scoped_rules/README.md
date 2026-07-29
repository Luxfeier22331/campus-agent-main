# scoped_rules 配置

本目录保存年度周期和限时适用规则的规范化、分块、查询兼容和采集任务配置。稳定校级规章属于
`institutional_rules`，来源通知仍属于对应通知集合。

## 文件

- `canonical-profile.json`：规则身份、适用范围和来源字段；
- `chunk-profile.json`：分块规则；
- `serving-config.json`：索引与查询兼容配置；
- `task-registry.v3.json`：本目录可执行的采集任务。

在线查询是否开放只由 `configs/runtime/query-serving-targets.v3.json` 决定；本目录文件存在不自动
建立查询目标。规则语义见 `docs/decisions/adr-0037-scoped-rules.md`，来源提升边界见
`docs/decisions/adr-0035-regulation-promotion.md`。
