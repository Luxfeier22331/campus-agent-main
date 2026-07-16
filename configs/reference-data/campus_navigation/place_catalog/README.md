# `campus_navigation/place_catalog`

本目录保存校园地点的 synthetic reference seed。当前 app-api 地图 read model 不加载该文件；
修改 seed 不会改变已发布浏览器地图。

本目录是 reference data，不是 ingestion-control collection；不声明 task registry、serving
config、retrieval alias 或 query-serving surface。

边界与开放数据规则见：

- `docs/domains/place.md`
- `docs/policies/public-source-data.md`

## 用途

- 保存 schema 与小型 synthetic sample；
- 为后续地点目录标准化提供离线输入；
- 不证明 chat、location card 或 navigation capability 已开放。

## 约束

- geometry 使用 `EPSG:4326`
- 允许 `point_geometry = null`；当官方来源只足以支持 canonical label 与 coarse location
  description 时，不伪造精确坐标
- provider id / provider schema 不进入 seed truth
- `verification_state` 用来标记人工确认状态；未做 field verification 的点位也必须显式标记
- 官方校园地图当前只用于 canonical label / campus-scope admission，不得直接反推精确 geometry
