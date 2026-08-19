# curriculum 采集配置

本目录维护培养方案的离线采集配置，不提供通用任务注册或在线调度。

## 当前状态

- `curriculum_plan/` 维护当前培养方案的 profile、split manifest 和合成样例；
- profile、split manifest 和合成样例属于独立 ingestion 数据面，不决定 Campus Docs 在线准入；
- 新增 collection 配置时只提交已有消费者需要的可执行合同，不保存待启用占位配置。

当前产品和查询边界见 `docs/architecture/domains/curriculum.md`。
