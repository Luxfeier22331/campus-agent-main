---
doc_type: contract
truth_scope: execution
owner_boundary: packages/contracts
status: active
created: 2026-04-11
updated: 2026-04-26
---
# Navigation Place Finding Contract

## 文档边界

本文记录 repo 内已定义但当前未开放为 model-visible tool 的
`place_lookup` / `place_finding` contract。`packages/navigation-tool` 当前只作为
navigation semantic specialist package 存在；产品主路径继续 fail closed，直到
runtime profile、tool registry 与前端地图产品面同时打开。

人类语义、产品 opening posture 与 place catalog 消费边界见
`docs/domains/place.md`。

它覆盖：

- `packages/contracts` 里的 shared place-finding types
- `execution-control -> typed navigation tool activity / internal query service`
  的 active execution seam
- `apps/app-api` 对 assistant structured parts 的归一化边界
- `apps/campus-web` 对地点卡片的消费形态

它不覆盖：

- `route_planning`
- `route_graph`
- full-map route interaction
- provider adapter、底图 SDK 或 renderer 细节

## Tool And Routing

- `requested_tool` caller hint 可表达 `place_lookup`
- `tool` projection label 可表达 `navigation`
- Go `apps/execution-control` 把用户地点问句 framing 成
  `PlaceLookupPayload(query_text=...)`
- 当前 `place_lookup` request 不接受 `requested_scope`

## Shared Contract (`packages/contracts`)

### `GeoPoint`

- `longitude: float`
- `latitude: float`

规则：

- 当前点位 geometry 使用 `EPSG:4326`
- 字段顺序固定为 `longitude` 后 `latitude`
- 这个顺序与 RFC 7946 / GeoJSON 的经纬顺序一致

### `PlaceRef`

- `place_id`
- `entity_type`
- `display_name`
- `campus_scope`
- `campus_area`

规则：

- `place_id` 是唯一跨 surface 的 canonical identity
- `entity_type` 当前只允许：
  - `building`
  - `service_point`
  - `office`
  - `gate`
  - `stop`
- provider IDs 不进入 shared contract

### `PlaceCard`

- `place: PlaceRef`
- `location_description`
- `landmark_hint`
- `access_note`
- `opening_note`
- `service_tags`
- `point_geometry`
- `coordinate_reference_system`
- `source_refs`

规则：

- `location_description` 是必需项
- `point_geometry` 允许为空
- 如果存在 `point_geometry`，`coordinate_reference_system` 当前应为 `EPSG:4326`

### `PlaceCandidate`

- `place: PlaceRef`
- `clarification_hint`

用途：

- alias 命中多个地点时返回 clarification candidates

### `PlaceLookupPayload`

- `query_text`

用途：

- `navigation` 的首发 place-finding 输入

### `PlaceLookupResult`

- `query_text`
- `matched_alias`
- `resolved_place`
- `place_card`
- `candidate_places`

规则：

- `completed` 时返回 `resolved_place`，通常同时返回 `place_card`
- `needs_clarification` 时返回 `candidate_places`
- `no_answer` 时允许只保留 `query_text` / `matched_alias`
- 当前结果字段继续使用 Python-side `snake_case`

## Terminal Semantics

当前 `navigation` 继续遵循 repo 已冻结的 execution terminal semantics：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`

固定规则：

- 命中多个 canonical place 时必须走 `needs_clarification`
- catalog 无可信命中时必须走 `no_answer`
- 不允许用 top1 猜测替代 clarification
- 不允许把 provider enrichment 反向升级为 canonical place truth

## App API Normalization

`apps/app-api` 不把上游 `snake_case` `PlaceLookupResult` 原样暴露给 browser。

当前 assistant structured part 固定为：

```json
{
  "type": "place_card",
  "placeCard": {
    "placeId": "muc.haidian.library",
    "entityType": "building",
    "displayName": "图书馆",
    "campusScope": "haidian",
    "campusArea": "主教学区西侧",
    "locationDescription": "海淀校区主教学区西侧，靠近校医院。",
    "landmarkHint": "从知行广场向西步行约 3 分钟可到达。",
    "accessNote": "校外访客请先完成入校登记。",
    "openingNote": "以图书馆当日公告为准。",
    "serviceTags": ["自习", "借阅", "打印"],
    "pointGeometry": {
      "longitude": 116.31551,
      "latitude": 39.96162
    },
    "coordinateReferenceSystem": "EPSG:4326",
    "sourceRefs": ["seed:campus_navigation/place_catalog.v1"]
  }
}
```

规则：

- 这份 shape 由 `app-api` 拥有
- 它持久化到 `chat.messages.structured_parts_json`
- 当前首发不保存 provider payload、provider ID、route polyline 或 route segment

## Online Answer Consumption

`apps/campus-web` 预留的 `place_card` browser shape 为：

```json
{
  "type": "data-place-card",
  "data": {
    "...": "same placeCard payload"
  }
}
```

当地图实际上线并恢复该能力后，UI 至少展示：

- 地点名称
- 实体类型
- 校区范围 / 区域
- 位置说明
- 地标提示
- 通行提示
- 开放说明
- 服务标签
- 点位坐标
- 来源引用

## Deferred

当前文档明确不打开以下 contract：

- route leg / waypoint contract
- route duration / distance summary
- accessibility routing
- entrance selection
- nearest-place ranking
- current-location input projection

## Related Docs

- `docs/architecture/domains/navigation/architecture.md`
- `docs/domains/place.md`
- `docs/decisions/adr-0027-navigation-tool-and-spatial-truth.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- `docs/contracts/tool-execution.md`
- `docs/data/place-catalog.md`
