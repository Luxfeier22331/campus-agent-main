# `campus_navigation/place_catalog`

当前 place-finding Wave E 的 canonical place seed。

## 用途

- 作为 `navigation-specialist` 的 repo-owned spatial truth 输入
- 提供 institution-scoped alias resolution，而不是把地点问句退回纯文档 RAG
- 为 chat 内 `location card` 提供稳定 `place_id`、entity taxonomy 与 point geometry

## 当前范围

首发只覆盖高频、位置稳定、运营价值明确的地点：

- 主要建筑
- 高频服务点
- 校门
- 少量校园周边 stop

## 约束

- geometry 使用 `EPSG:4326`
- provider id / provider schema 不进入 seed truth
- `verification_state` 用来标记人工确认状态；未做 field verification 的点位也必须显式标记
