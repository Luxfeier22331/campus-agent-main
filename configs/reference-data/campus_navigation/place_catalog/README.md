# `campus_navigation/place_catalog`

当前 place-finding canonical place seed。

This directory is reference data, not an ingestion-control collection. It does
not declare a task registry, serving config, retrieval alias, or query-serving
surface.

Source inventory / admission posture:

- `docs/reference/campus-navigation-authoritative-source-inventory.md`

## 用途

- 作为 `navigation-specialist` 的 repo-owned spatial truth 输入
- 提供 institution-scoped alias resolution，而不是把地点问句退回纯文档 RAG
- 为 chat 内 `location card` 提供稳定 `place_id`、entity taxonomy 与受控 geometry posture

## 当前范围

首发只覆盖高频、位置稳定、运营价值明确的地点：

- 主要建筑
- 高频服务点
- 校门
- 少量校园周边 stop

## 约束

- geometry 使用 `EPSG:4326`
- 允许 `point_geometry = null`；当官方来源只足以支持 canonical label 与 coarse location
  description 时，不伪造精确坐标
- provider id / provider schema 不进入 seed truth
- `verification_state` 用来标记人工确认状态；未做 field verification 的点位也必须显式标记
- 官方校园地图当前只用于 canonical label / campus-scope admission，不得直接反推精确 geometry
