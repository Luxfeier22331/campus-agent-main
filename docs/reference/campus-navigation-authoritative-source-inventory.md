---
doc_type: reference
status: active
created: 2026-04-14
updated: 2026-04-14
---
# Campus Navigation Authoritative Source Inventory

## 文档边界

本文只负责中央民族大学 `place_catalog` 当前可用的 authoritative source inventory、candidate
inventory 和 admission posture。

它回答的是：

- 当前有哪些官方来源可以用来冻结 canonical place label 与 `campus_scope`
- 第一批高频地点候选有哪些
- 哪些候选当前可以直接进入 seed，哪些仍需先 park
- 哪些同名地点 family 必须 clarification-first

它不负责：

- `route_graph`
- 路线规划
- 底图 provider / SDK 选型
- 把示意图直接当精确坐标或 route truth

## 当前 authoritative source

### Primary

- 中央民族大学校园地图
  - `<https://www.muc.edu.cn/xxgk1/xydt.htm`>
  - 用途： - 冻结校区范围 - 冻结官方地点名称 - 冻结第一批 building / gate / public-facility candidate
    inventory

- 中央民族大学校园导游
  - `<https://www.muc.edu.cn/ggfw/xydy.htm`>
  - 用途： - 作为官方补充语境 - 验证海淀 / 丰台校区的公共服务语义 - 补充校区入口与公共服务场景

### Consumed official map images

- 海淀校区地图
  - `<https://www.muc.edu.cn/__local/F/91/AB/7FD57D5626A89FCED2B52241DFC_FD318D0
    B_612F3.png`>

- 丰台校区地图
  - `<https://www.muc.edu.cn/__local/D/06/88/ED290FD6FCD89E0B4A6A5D0ADDA_11770E2
    B_26733.jpg`>

## Source usage rules

- 上述官方来源当前足以作为 canonical place label 与 `campus_scope` 的 authoritative truth。
- 上述官方来源当前不足以单独作为精确 `point_geometry` truth。
- 不允许根据示意图上的视觉位置直接反推精确坐标并写入 seed。
- 如果地点名称和校区归属已确认，但 geometry 仍缺受控来源，可以在以下条件同时满足时以 `point_geometry = null`
  admitted into seed：
  - `location_description` 仍可由官方地图支持到 coarse level
  - `source_refs` 显式保留 official page / image URL
  - `verification_state` 明确标记为仍待 field / geometry check

## External rationale

- `GeoJSON` 的 `Feature` 允许 `geometry = null`，说明“有实体真相但暂缺可用
  geometry”是标准可接受形态，而不是必须伪造坐标。
- 主流 geocoder 也显式区分 `ROOFTOP` 和 `APPROXIMATE` 这类几何置信度，因此近似位置不应被静默提升为 canonical
  point truth。

参考：

- `<https://datatracker.ietf.org/doc/rfc7946/`>
- `<https://developers.google.com/maps/documentation/geocoding/requests-geocodin
  g`>

## Admission posture

### `seed_ready`

满足以下任一受控形态，才允许进入
`configs/ingestion/campus_navigation/place_catalog/seed.v1.json`：

- 官方来源已确认 canonical name
- 校区归属明确
- `entity_type` 明确
- geometry 已有受控来源或既有人工校准
  - 或者 `point_geometry = null`，但 coarse location description / provenance /
    verification posture 完整
- `verification_state` 可显式落盘

### `park_pending_geometry`

满足以下任一情况，当前不得直接进 seed：

- 只有官方示意图名称，但连 coarse location description 都不足以形成稳定 answer
- 名称存在，但同名 family 仍需先冻结 clarification expectation
- 服务点语义尚不稳定，容易误把建筑内部功能点当作 canonical place

## Current seed-backed rows

下列点位当前已经在 seed 中存在：

- 海淀图书馆
- 学生服务中心补卡机（海淀）
- 教务处（海淀）
- 海淀校区北门
- 海淀校区南门
- 丰台校区南门
- 魏公村地铁站
- 丰台校区北门
- 丰台图书馆
- 海淀校医院
- 丰台校医院
- 民族博物馆（海淀）

其中：

- 已具备受控 geometry 的 row：
  - 海淀图书馆
  - 学生服务中心补卡机（海淀）
  - 教务处（海淀）
  - 海淀校区北门
  - 海淀校区南门
  - 丰台校区南门
  - 魏公村地铁站
- 以 `point_geometry = null` admitted 的 official-label-backed row：
  - 丰台校区北门
  - 丰台图书馆
  - 海淀校医院
  - 丰台校医院
  - 民族博物馆（海淀）

## First-batch candidate inventory

### 海淀校区

#### Candidate families already visible on official map（丰台）

- 西校门
- 东大门
- 东小门
- 校医院
- 民族博物馆
- 逸夫体育馆
- 大礼堂
- 北综合楼
- 理工楼

#### Current posture（丰台）

- `西校门` / `东大门` / `东小门`
  - canonical name 与 campus scope 已确认
  - 当前 `park_pending_geometry`
- `逸夫体育馆` / `大礼堂` / `北综合楼` / `理工楼`
  - canonical name 与 campus scope 已确认
  - 当前 `park_pending_geometry`

### 丰台校区

#### Candidate families already visible on official map

- 丰台校区北门
- 图书馆
- 综合楼
- 大礼堂
- 学生活动中心
- 校医院
- 综合体育馆
- 北体育场
- 南体育场
- 教师公寓
- 聚贤餐厅
- 馨雅餐厅

#### Current posture

- `综合楼` / `大礼堂` / `学生活动中心` / `综合体育馆` / `北体育场` / `南体育场` / `教师公寓` / `聚贤餐厅` /
  `馨雅餐厅`
  - canonical name 与 campus scope 已确认
  - 当前 `park_pending_geometry`

## Clarification-first ambiguity families

当前已冻结、不得 top1 硬猜的同名 family：

- `图书馆`
  - 海淀图书馆
  - 丰台图书馆
- `北门`
  - 海淀校区北门
  - 丰台校区北门
- `南门`
  - 海淀校区南门
  - 丰台校区南门
- `校医院`
  - 海淀校医院
  - 丰台校医院

规则：

- generic family query 默认 `needs_clarification`
- campus-qualified alias 允许直接命中
- 不允许因为历史 seed 只有一个成员，就把 generic family 当成单一真相

## Next Step Trigger

当前 `1001-02` 已完成第一批 official-label-backed row 的 seed admission。由于 2026-04-14
起当前产品路径已明确暂不支持校内导航，`1001-03` staging/manual acceptance evidence 已转入 backlog
`999.2`，等待地图实际上线后再恢复。

在此之前，repo 已完成的是：

- authoritative source inventory
- candidate inventory
- admission posture
- ambiguity family truth
- 第一批 official-label-backed seed admission

当前仍未完成的是：

- 剩余 parked candidate 的后续 admission
- 地图实际上线后的真实 staging smoke / 人工验收证据
