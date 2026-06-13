---
doc_type: architecture
truth_scope: capability
owner_boundary: domains/navigation
status: active
created: 2026-04-05
updated: 2026-06-12
---
# Navigation And Wayfinding Architecture

## 文档边界

本文冻结 `campus-agent` 长期导航 / wayfinding 能力的 supporting architecture。

它回答的是：

- 校园导航在长期产品形态里属于什么能力边界
- Execution Agent Layer、`navigation`、`app-api`、spatial truth 各自负责什么
- 用户当前位置、地点别名、路线图谱与地图呈现分别属于哪一层
- 外部地图 provider 与瓦片地图在长期形态里应怎样参与

它不负责：

- 当前是否已经落地导航 agent
- 某一轮 phase 的执行顺序
- 某个 provider、SDK 或路径算法的最终实现选型
- 某个前端地图组件的具体交互设计

## Core Conclusion

长期上，`campus-agent` 应扩展为同时覆盖：

- institutional knowledge question answering
- campus service discovery
- campus navigation / wayfinding

其中导航不是附属工具，而是 Execution Agent Layer-led multi-capability / agent-as-tool
product 中的稳定 capability family。

长期导航主链路固定为：

```text
web surface -> app-api -> execution-control -> Temporal activity
-> capability worker -> navigation / typed spatial tools
-> spatial truth / provider adapters -> execution response
```

在长期 multi-capability / agent-as-tool workflow 中，`navigation` 也可以作为 bounded spatial
specialist 被调用，向其它 domain agent 或 Go finalizer 提供 `PlaceContext`、
`StopContext`、route summary 或 accessibility warning projection。它不因此拥有
timetable truth、service-status truth、notice truth 或 retrieval evidence truth。

## Product Goal

长期用户可见目标至少包括：

- `place_lookup` 例如“图书馆在哪”
- `route_planning` 例如“从北门到图书馆怎么走”
- `entrance_selection` 例如“去文科楼从哪个门进更近”
- `accessibility_routing` 例如“轮椅可达怎么走”
- `location_aware_guidance` 例如“我现在在东操场，去教务处怎么走”

长期完成态不是只返回一段自然语言，而是返回：

- explanation text
- structured route segments
- distance / duration summary
- place / waypoint references
- warnings / restrictions
- clarification or fail-close reason when needed

## Navigation Surface Model

长期导航入口模型固定为：

- `multi-entry`
- `shared control plane`
- `navigation truth shared across surfaces`

直接含义：

- 导航能力既可以被 chat surface 消费，也可以被未来独立的 map / wayfinding surface 消费
- chat 内 route card、mini-map 与路线解释仍然是重要消费形态，但不再被提升为唯一产品入口真相
- 如果未来存在独立地图入口，它也必须与 chat 共享同一条 `app-api -> execution-control -> navigation`
  truth chain

长期推荐形态包括：

- chat message 内的 route card
- chat message 内的 mini-map / route preview
- 同一产品体系下的 full-map surface 或 full-screen map view

明确不做：

- 不把“跳转外部地图站”作为默认主路径
- 不把 chat 与地图消费拆成两套 canonical route / place / audit 真相
- 不让任何地图视图绕过 `app-api` / request correlation / audit projection

## Execution Ownership

### `apps/execution-control`

长期负责：

- intent framing
- risk / safety gate
- capability routing
- handoff shaping
- response finalization

长期不负责：

- place alias business rules
- route graph search
- provider-specific route or geocode logic
- browser map rendering

### `packages/navigation-capability`

长期负责：

- place / building / entrance / gate / stop resolution
- route planning inside the capability boundary
- ambiguity handling and clarification
- navigation answer shaping
- provider candidate orchestration inside the capability boundary
- transport pickup/dropoff point ref 的消费与路线侧整合
- manager-style workflow 中的 bounded `PlaceContext` / `StopContext` step output
  projection

长期不负责：

- canonical app identity / session / memory ownership
- raw browser permission handling
- product-facing HTTP transport
- commuter bus / metro shuttle 的 timetable truth
- service-status truth，例如图书馆/澡堂/窗口当前开放状态
- notice temporal override truth
- retrieval answer-bearing evidence selection

### `apps/app-api`

长期负责：

- location permission input ownership at the product boundary
- request-scoped typed navigation context projection
- canonical request identity and audit / projection input

### `apps/public-chat-web` / future navigation surfaces

长期负责：

- route card / map / waypoint presentation
- location permission UX
- place selection and manual disambiguation input
- full-map interaction view 或独立 navigation shell

它们不拥有：

- route correctness truth
- canonical place / graph truth

## Truth Model

长期导航相关真相固定拆分如下：

- `spatial truth` 校园建筑、入口、校门、道路、连通关系、限制规则；属于 `institutional knowledge` 的子域
- `situational location context` 当前请求里的起点、终点、位置来源、精度、时效；属于 app-owned
  request-scoped typed projection
- `profile preference` 例如偏好步行、偏好无障碍路线、偏好少楼梯；属于 profile memory

固定边界：

- `spatial truth` 不属于 profile memory 或 session memory
- `current location` 不属于 account / session、operator access 或 source truth
- `current location` 不得被静默提升成长期 memory truth
- preference 可以影响 route ranking / wording，但不能替代 origin / destination truth
- transport schedule、service status 与 notice effective window 不是 route-graph
  truth；如需进入导航域，只能以 point ref / service point ref 形式受控投影

## Spatial Data Plane Goal

长期 repo-owned spatial truth 至少拆成两个能力层：

- `campus_navigation/place_catalog` canonical place facts，例如 building / entrance
  / gate / stop / service point
- `campus_navigation/route_graph` canonical route graph truth，例如
  nodes、edges、restrictions、accessibility attributes、time-window closure

其中：

- `place_catalog` 可以表现为 agent-consumable internal retrieval / facts surface
- `route_graph` 默认视为 agent-private execution artifact，而不是自动提升为默认公开 query-serving
  surface

长期规则：

- source truth 仍走 repo canonical data plane
- spatial truth 必须可版本化、可重建、可追溯
- provider response 不反向成为 canonical place / route truth

## Alias And Entity Resolution

长期 place alias 治理采用 canonical entity resolution，而不是字符串替换。

当前应至少接受以下 entity type：

- `place`
- `building`
- `entrance`
- `gate`
- `stop`

固定规则：

- alias 必须带 institution scope
- alias resolution owner 在 `navigation`
- retrieval / graph executor 只消费 canonical entity truth，不消费自由文本 alias 真相
- 高歧义地点默认进入 `needs_clarification`，不得用 top1 猜测代替

## Request Projection And Privacy

长期执行链路允许把导航输入作为 request-scoped typed projection 进入 execution path。

其长期语义至少包括：

- origin
- destination
- travel mode
- accessibility mode
- location source type
- location freshness / confidence

固定规则：

- 这些输入不得塞进 `ActorContext`
- 这些输入不得塞进 `AuthorizationProjection`
- 这些输入不得通过 raw transcript 恢复
- raw GPS / raw coordinates 默认不进入长期 profile memory
- session 如需承接上一轮导航上下文，应优先使用 coarse place ref 或 typed slot，而不是坐标轨迹

## Tile Map And Provider Posture

长期允许产品 surface 使用瓦片地图或其他底图能力，但它的角色固定为：

- presentation / interaction layer
- optional location input aid
- optional route overlay carrier

瓦片地图不是：

- canonical spatial truth
- route correctness truth
- agent capability boundary
- shared contract vocabulary

长期 provider posture 固定为：

- browser geolocation 是 input source，不是 canonical truth
- map / geocode / route provider 是 adapter，不是 campus truth owner
- provider geocode、POI search、secondary route candidates 可以参与
  navigation capability 内部执行
- provider-specific IDs、SDK types、payload shapes 不进入 `packages/contracts`

针对“学校 + 周边关键地点”的底图、自建范围与 provider 成本 posture，见
`docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`。

## Result Posture

长期导航结果必须继续兼容 repo 现有 execution terminal semantics：

- `completed`
- `needs_clarification`
- `no_answer`
- `error`
- `rejected`

直接含义：

- 无法安全解析地点时，应 `needs_clarification`
- 缺少可信 route truth 时，应 `no_answer` 或 `error`
- spatial truth 尚未开放、来源不足或地点不可安全解析时，应 fail-closed
- 不得在导航域为了“更像地图 app”而绕开 execution 终态合同

## Non-Goals

本文当前不冻结：

- 全城级驾车导航
- 实时拥堵、人流、动态 ETA
- 室内高精度连续定位
- 蓝牙 / IMU / beacon 方案
- 某个前端地图 renderer 或 tile provider 的唯一选型
- 某个 provider 的计费、quota 或 SDK 初始化细节

## Related Stable Docs

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/decisions/adr-0005-campus-services-taxonomy.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.m
  d`
- `docs/decisions/adr-0021-institution-scoped-entity-alias-governance.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
