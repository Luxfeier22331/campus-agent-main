---
doc_type: data
status: active
created: 2026-04-11
updated: 2026-04-11
---

# Campus Navigation Place Catalog

## 文档边界

本文冻结 `campus_navigation/place_catalog` 的当前 data truth。

它覆盖：

- repo-owned seed 的字段形态
- canonical place identity 与 alias 规则
- geometry / provenance / verification 规则
- 当前 runtime profile posture

它不覆盖：

- `route_graph`
- 路线规划算法
- provider enrichment 内部存储
- 地图 renderer 或底图 SDK

## 当前 Artifact 位置

- seed：`configs/ingestion/campus_navigation/place_catalog/seed.v1.json`
- runtime profile：`configs/ingestion/campus_navigation/place_catalog/runtime-profile.json`
- consumption owner：`packages/navigation-specialist`

## 当前用途

`place_catalog` 当前是：

- `navigation-specialist` 的 repo-owned spatial truth 输入
- alias-first place resolution 的 canonical source
- chat `location card` 的稳定 place truth

它当前不是：

- 默认公开 query-serving surface
- provider geocode / POI payload 缓存
- route graph truth

## Record Shape

每条 canonical place 当前至少包含：

- `place_id`
- `entity_type`
- `display_name`
- `aliases`
- `campus_scope`
- `campus_area`
- `location_description`
- `landmark_hint`
- `access_note`
- `opening_note`
- `service_tags`
- `point_geometry.longitude`
- `point_geometry.latitude`
- `coordinate_reference_system`
- `source_refs`
- `verification_state`

## Field Rules

### `place_id`

- repo-owned canonical identity
- 当前命名采用 institution-scoped dotted id，例如 `muc.haidian.library`
- 这是唯一允许跨 contract / app / UI 透传的 place identity

### `entity_type`

当前首发只允许：

- `building`
- `service_point`
- `office`
- `gate`
- `stop`

### `aliases`

- alias 必须 institution-scoped
- 相同 alias 可以跨校区或跨地点重复存在
- 如果 alias 命中多个 canonical place，`navigation-specialist` 必须返回 clarification，而不是 top1 猜测

### `point_geometry`

- 当前只接受 point-level geometry
- 当前 seed 使用 `EPSG:4326`
- 字段顺序固定为 `longitude` 后 `latitude`

### `source_refs`

- 记录当前 place truth 的来源线索
- 当前 seed 默认使用 `seed:campus_navigation/place_catalog.v1`

### `verification_state`

- 必须显式记录
- 当前示例值包括：
  - `manual_seed_reviewed`
  - `manual_seed_pending_field_check`

规则：

- 即使还未做 field verification，也必须显式标注状态
- 不允许把“尚未核验”静默当成“已确认”

## Excluded Data

以下内容当前不得进入 canonical place catalog：

- provider-specific place ID
- provider response blob
- SDK renderer type
- route polyline / route segment
- browser geolocation raw track

## Runtime Profile Posture

当前 `runtime-profile.json` 固定为：

- `corpus = campus_navigation`
- `collection = place_catalog`
- `serving_mode = offline_preparation`
- `retrieval_enabled = false`
- `query_enabled_by_default = false`

直接含义：

- `place_catalog` 当前是 specialist-private truth，不是公开 query surface
- 它不会通过默认 retrieval-serving alias 对外开放
- `app-api` 也不应把它伪装成 `requested_scope`

## 首发范围

当前 seed 只覆盖高频、位置稳定、运营价值明确的地点：

- 主要建筑
- 高频服务点
- 办公点
- 校门
- 少量校园周边 stop

这是一条受控 seed，不是“全校 POI 已完成”的宣称。

## Related Docs

- `docs/contracts/navigation-place-finding-contract.md`
- `docs/architecture/navigation-and-wayfinding-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- `docs/plans/campus-place-finding-foundation.md`
