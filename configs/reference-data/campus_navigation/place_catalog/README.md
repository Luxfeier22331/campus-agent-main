# `campus_navigation/place_catalog`

本目录保存校园地点的合成参考样例。当前 App API 地图读取模型不加载该文件；修改样例不会改变
已发布的浏览器地图。

本目录是参考数据，不是 ingestion-control 集合，也不定义采集任务、检索别名或在线查询能力。

边界与开放数据规则见：

- `docs/domains/place.md`
- `docs/policies/public-source-data.md`

## 用途

- 保存 schema 与小型合成样例；
- 为后续地点目录标准化提供离线输入；
- 不表示聊天、地点卡片或导航能力已经开放。

## 约束

- geometry 使用 `EPSG:4326`；
- 允许 `point_geometry = null`；当官方来源只足以支持 canonical label 与 coarse location
  description 时，不伪造精确坐标；
- 供应商标识和供应商数据结构不进入参考事实；
- `verification_state` 标记人工确认状态，未现场确认的点位也必须显式标记；
- 官方校园地图当前只用于规范名称和校区范围判断，不得直接反推精确 geometry。
