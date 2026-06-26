---
doc_type: data
truth_scope: data
owner_boundary: domains/navigation
status: active
created: 2026-04-11
updated: 2026-04-14
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
- runtime profile：`configs/ingestion/campus_navigation/place_catalog/runtime-pro
  file.json`
- consumption owner：`packages/navigation-capability`
- authoritative source
  inventory：`docs/reference/campus-navigation-authoritative-source-inventory.md`

## 当前用途

`place_catalog` 当前是：

- `navigation` 的 repo-owned spatial truth 输入
- alias-first place resolution 的 canonical source
- 地图实际上线后 `place_card` / map surface 的预留 place truth

它当前不是：

- 当前已开放的产品 query surface
- 默认公开 query-serving surface
- provider geocode / POI payload 缓存
- route graph truth

## 当前产品状态

- 当前 execution 产品路径已对 `place_lookup` fail-close
- 校内导航 / 地点查询暂不作为已开放能力，等待地图产品上线后再开放
- `place_catalog` 继续保留为 repo-owned spatial truth foundation，而不是当前浏览器可消费 surface
- `place_card` / map consumption 已后置到地图实际上线后的 backlog

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
- `point_geometry.longitude` / `point_geometry.latitude`（如果存在）
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
- 如果 alias 命中多个 canonical place，`navigation` 必须返回 clarification，而不是 top1
  猜测

### `point_geometry`

- 当前只接受 point-level geometry
- 当前 seed 使用 `EPSG:4326`
- 字段顺序固定为 `longitude` 后 `latitude`
- 官方示意图当前只用于 label / campus-scope admission，不得直接反推精确 geometry
- 允许为空；当官方来源足以支持 canonical label 与 coarse `location_description`，但不足以支持精确 point
  truth 时，row 可以以 `point_geometry = null` admitted into seed

### `source_refs`

- 记录当前 place truth 的来源线索
- 当前 seed 默认使用 `seed:campus_navigation/place_catalog.v1`
- 当点位由官方 `校园地图` / `校园导游` admitted 时，应同时保留相应 official page / image URL

### `verification_state`

- 必须显式记录
- 当前示例值包括：
  - `manual_seed_reviewed`
  - `manual_seed_pending_field_check`

规则：

- 即使还未做 field verification，也必须显式标注状态
- 不允许把“尚未核验”静默当成“已确认”

## Current Authoritative Source Posture

当前 authoritative source posture 已冻结为：

- official map / official campus-tour page 负责 canonical place label 与
  `campus_scope`
- geometry 有两种受控 admitted 形态：
  - 已有受控来源或人工校准的 point geometry
  - `point_geometry = null`，但 coarse location description / provenance /
    verification posture 完整
- 仅靠示意图视觉位置、且连 coarse 位置描述都不足的 candidate，仍必须先 `park_pending_geometry`

详见：

- `docs/reference/campus-navigation-authoritative-source-inventory.md`

## Current Ambiguity Families

当前已冻结 clarification-first 的同名 family 包括：

- `图书馆`
- `北门`
- `南门`
- `校医院`

规则：

- generic family query 默认 `needs_clarification`
- campus-qualified alias 允许直接命中
- 不允许因为某个 family 当前只收录了一个成员，就把 generic name 误写成单目标 truth

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

- `place_catalog` 当前是 agent-private truth，不是公开 query surface
- 它不会通过默认 retrieval-serving alias 对外开放
- `app-api` 也不应把它伪装成 `requested_scope`
- 当前产品路径也不应把它伪装成已开放的导航回答能力

## 首发范围

当前 seed 已覆盖 `12` 个高频、位置稳定、运营价值明确的地点，其中一部分 row 采用 nullable geometry posture：

- 主要建筑
- 高频服务点
- 办公点
- 校门
- 少量校园周边 stop

这是一条受控 seed，不是“全校 POI 已完成”的宣称。

## Related Docs

- `docs/contracts/navigation-place-finding-contract.md`
- `docs/domains/navigation.md`
- `docs/reference/campus-navigation-authoritative-source-inventory.md`
- `docs/architecture/domains/navigation/architecture.md`
- `docs/decisions/adr-0027-navigation-capability-and-spatial-truth.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
