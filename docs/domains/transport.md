---
doc_type: domain
owner_boundary: domains/transport
status: active
---
# 班车时刻表

本文是班车时刻表领域唯一的人类可读文档，统一说明工具、状态页、来源与存储边界。

## 边界

当前范围只包含已发布的校园班车时刻表。

包含：

- 模型可见、只读的 SDK function tool `transport_schedule_lookup`；
- campus-web services/status 页面使用的班车投影；
- 已发布时刻表的 release metadata、source URL、route row、departure row 与 row-level 临时
  变更。

不包含：

- 通用 campus service status lookup；
- service guide、contact directory、process guide 或 wiki 页面；
- 浏览器状态页的任意日期查询；
- 查询时扫描 raw notice、HTML、object storage prefix 或 retrieval chunk。

## 消费链路

模型与浏览器都消费 `campus_services.*` 中同一 release 和 current pointer，但各自使用适合的
read shape。

```text
已校验的发布输入
  -> jobs/transport-publisher
  -> campus_services.transport_releases + transport_current
     -> app-api 读取当前 status_json
        -> GET /api/campus-services/transport-schedule/status
        -> campus-web 服务状态页
     -> execution-control 读取结构化线路与发车行
        -> POST /internal/query/campus-services/transport-schedule
        -> transport_schedule_lookup
```

`app-api` 只负责面向浏览器读取状态。其 database role 可以读取 current pointer 与 release
status JSON，不能读取 typed route/departure row；它不得发布 transport truth、重建时刻表或
维护第二个 current pointer。`execution-control` 不代理浏览器状态接口。

状态页不得调用 `transport_schedule_lookup`，只渲染当前已发布时刻表的 materialized status
projection。

app-api 浏览器接口返回已存 display projection 与 cache validator，不得暴露 execution-control
`result_envelope`、raw notice body、内部 object locator 或非 URL provenance ref。

## 工具

`transport_schedule_lookup` 按 intent 回答：

- `next_departure`
- `first_departure`
- `last_departure`
- `departure_list`
- `service_window`
- `timetable`
- `schedule_snapshot_metadata`

只有 runtime registry、严格 function schema、workflow artifact、Go runtime readiness 和
product-path gate 全部一致时，工具才开放。机器合同以
`packages/contracts/schemas/campus-services-tool-contracts.v1.schema.json` 为准。

无法证明 currentness、source truth、selector disambiguation、temporal scope 或 projection
readiness 时，工具失败关闭；不得回退到通用 retrieval、notice HTML 扫描、object-store 扫描或
面向浏览器的 app-api 回环。

## 状态页投影

浏览器接口为：

```text
GET /api/campus-services/transport-schedule/status
```

display projection 包含：

- 已发布时刻表版本的 release id、publish time 与 source URL；
- display group：`daily`、`weekday`、`weekend_holiday`、`temporary`；
- 包含有序 departure row 的 route row；
- 日期专用临时 row 上可选的 `serviceDate`；
- row-level status：`normal`、`added`、`cancelled`、`changed`、`delayed`；
- 临时或变更 row 的 source URL。

投影不包含 route-level source、group-level source、arrival-time diff、original/effective diff
字段或人工编辑的 final JSON。能匹配 baseline route 的临时变更留在原 route 中；只有无法匹配的
临时 row 进入 `temporary` group。

状态机器合同以 `packages/contracts/schemas/transport-schedule-status.v1.schema.json` 为准。

## 来源与存储

source channel 是 authenticated notice。`jobs/transport-publisher` 接收已验证 publication
payload，并以原子事务写入 release。notice 自动化可以准备该 payload，但查询代码不解释
notice；已发布版本与 row-level change 保留 source URL。

transport 领域只保存归一化 change/projection fact，不保存 raw notice content。原始 notice
内容仍由 notice source channel 拥有。

runtime 从 database/current projection 消费：

- `campus_services.transport_releases`：release metadata 与 materialized status JSON；
- `campus_services.transport_current`：唯一 current pointer；
- `campus_services.transport_routes` 与 `transport_departures`：typed tool read model。

对象存储可以保留 immutable release artifact 或 archive，但不是在线消费事实，查询时刻表不得
依赖对象存储。

## 更新规则

发布新时刻表时，在一个事务中插入已验证 release row 并移动唯一 current pointer。工具与浏览器
状态接口通过该 pointer 观察新 release；更新时刻表数据不需要重新部署 frontend 或
execution-control。

current projection 缺失、无效或不可验证时，工具与状态接口失败关闭，不在请求时生成
best-effort 时刻表。

该失败只影响 transport capability。只要 PostgreSQL read-model 连接健康，缺少 current release
不得使 execution-control、app-api、chat、memory、knowledge query 或 deployment readiness
失败。在 notice ingestion 重做完成并发布有效 release 前，状态接口返回 unavailable，tool
preflight 保持 blocked。
