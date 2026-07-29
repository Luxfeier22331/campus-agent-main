# student_rules 配置

本目录保存学生手册和学生管理规章的规范化、分块、来源投影和采集任务配置。

## 文件

- `canonical-profile.json`：文档身份与元数据；
- `chunk-profile.json`、`query-planning.json`：分块和查询规划；
- `source-projections.v1.json`、`split-manifest.v1.json`：公开合成来源与逻辑文档边界；
- `serving-config.json`：索引与查询兼容配置；
- `task-registry.v3.json`：本目录可执行的采集任务。

查询开放状态、路由词和逻辑映射由 `configs/runtime/query-serving-targets.v3.json` 维护，任务能力由本目录
注册表维护。真实来源数据不由公开合成 fixture 替代。

领域边界见 `docs/architecture/domains/regulations.md`，学生手册处理规则见
`docs/policies/student-rules-chunking.md`。
