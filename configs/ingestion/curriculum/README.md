# curriculum 采集配置

本目录只维护有当前任务注册的培养方案离线采集配置。

## 当前状态

- `curriculum_plan/` 是当前唯一登记了 `task-registry.v3.json` 的培养方案采集目标；
- profile、split manifest 和合成样例属于独立 ingestion 数据面，不决定 Campus Docs 在线准入；
- 新增 collection 配置时，必须同时提供指向该 collection 的当前任务注册，不能保存待启用占位配置。

当前产品和查询边界见 `docs/architecture/domains/curriculum.md`。
