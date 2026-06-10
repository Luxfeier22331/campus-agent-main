---
doc_type: contract
status: active
created: 2026-04-23
updated: 2026-04-28
---
# Transport Schedule Lookup Contract

## 文档边界

本文冻结 `transport_schedule_lookup` 的 stable contract direction。

它覆盖：

- `packages/contracts` 内 transport schedule shared types 的目标 shape
- `execution-control -> typed capability activity / internal query service`
  的 active execution seam
- `campus_services -> typed tool adapter -> internal query service`
  的 request/result seam
- route、班次、首末班、运营窗口、停运公告引用与 schedule snapshot metadata 的 typed
  结果边界

它不覆盖：

- 班车采集器、parser、对象存储命名或 projection schema 的实现细节
- browser-facing card payload 或 panel 像素设计
- `service_status_lookup` 的通用服务开放状态 contract
- query planner / capability admission 的 repo 级总路由策略

## 当前 Rollout 状态

- `transport_schedule_lookup` 已通过 `campus-services-product-path` opening gate，
  tool-level verdict 为 `open`（Phase 6，2026-04-27）。
- `transport_schedule_lookup` 是 repo-owned ToolSpec-admitted read-only typed tool。
  projection-backed schedule query、route/snapshot temporal policy、source
  provenance、admission 与 finalization 归 repo-owned runtime。
- 公开 answer / stream 入口的目标路径是 typed Temporal activity / worker contract。
  内部 structured query endpoint 由 Go runtime 提供；任何 SDK / Python adapter
  只能作为 offline / eval / historical reference，不作为 active serving handoff。
- `packages/contracts`、Go structured query runtime、ToolSpec /
  CapabilitySpec seam 与 projection-backed data-plane 均已纳入 opening gate
  denominator。
- local gate 判定命令：
  `uv run --all-packages python -m scripts.eval_gate accept --profile
  campus-services-product-path --json`
- rollout flag 仍由 Go runtime 持有：
  `EXECUTION_CONTROL_OPEN_CAPABILITIES=campus_services`。
- 未设置该 flag 时，产品路径仍必须 fail-close。

## Core Conclusion

`transport_schedule_lookup` 必须是 intent-first 的单一 tool contract，而不是“route query +
时间窗口”的自由文本查询。

固定结论：

- 班车问句继续收敛到一个 tool，不拆第二个“版本查询 tool”
- `schedule_snapshot_metadata` 与 `timetable` 属于同一 capability 家族，只是 intent 不同
- trusted current time 由 runtime/access context 注入，不由用户 payload 伪造
- 用户未给出足够的路线类型、方向或站点约束时，必须先 clarification，不默认罗列所有班车族
- `snapshot_query` 与 `service_time_query` 是两层不同语义
  - `snapshot_query` 决定使用哪一版时刻表 truth
  - `service_time_query` 决定在该 truth 下查询哪个服务日、哪个时间段

## Projection Backing

`transport_schedule_lookup` 的 runtime backing 固定读取
`campus_services_projection_bundle.v1`。

第一版 data-plane 决策：

- source truth 只来自 `authenticated_notice_portal`
- route canonical seed 覆盖跨校区通勤车、地铁接驳车与已物化的临时专车 route
- builder 离线展开 90 天服务日
- 临时停运/调整写入 `transport_service_exceptions`
- 对象存储保存 immutable versioned artifact；current artifact 只保留为
  compatibility surface
- Go `apps/execution-control` 不直接读取对象存储或 mounted projection file；长期通过
  projection-backed internal query service 读取 PostgreSQL current pointer 与 typed
  read model

projection schema 细节见
`docs/data/campus-services-transport-schedule-source-truth-schema.md`。

## Intent Taxonomy

当前冻结的 `intent` 闭集为：

- `next_departure`
  - 问“最近一班”“下一班”“几点还有车”
- `first_departure`
  - 问“最早一班”
- `last_departure`
  - 问“最后一班”
- `departure_list`
  - 问“还有哪些班次”“17:00 以后有哪些”
- `service_window`
  - 问“运营时间”“今天跑到几点”“今天这条线还跑不跑”
- `timetable`
  - 问“某条线的时刻表是什么”
- `schedule_snapshot_metadata`
  - 问“最近一版时刻表什么时候发布”“当前有效的是哪一版”

补充归一化规则：

- “哪条班车去丰台”“北门到丰台坐哪条线”这类 route-resolution 问题，首轮仍归一到最接近的
  schedule intent，并在 tool 内以 `clarification_required` 结束，而不是为首轮额外拆一个
  route-only tool
- “今天是不是停运了”“当前还能不能跑”这类 transport-specific status 问句，首轮归一到
  `service_window`
  - 结果可以只填 `service_status` 与 `related_notice_refs`
  - 如果 current truth 不可证，必须 fail-close
- “班车怎么坐”“接驳车怎么预约”“乘车规则是什么”这类 how-to / 规则 /
  预约说明问题不属于 `transport_schedule_lookup`；应路由到 `service_guide_lookup`
  的只读办理 / 使用说明语义

## Request Contract

### Frozen Forward Request Shape

```text
TransportScheduleLookupPayload
- query_text: str
- intent:
  - next_departure
  - first_departure
  - last_departure
  - departure_list
  - service_window
  - timetable
  - schedule_snapshot_metadata
- route_selector: TransportRouteSelector | null
- snapshot_query: TemporalQuery
- service_time_query: TransportServiceTimeQuery | null
- result_limit: int | null
```

固定语义：

- `query_text` 保留用户原问句，不能为空
- `intent` 由 capability router / agent framing 显式给出，不由 tool 内部再猜
- `route_selector` 表达已知路线约束；如果缺失且该 intent 需要路线分辨，tool 必须走 clarification
- `snapshot_query` 复用现有 `TemporalQuery`
  - 默认 `mode=current`
  - 它只决定“哪一版 schedule snapshot”
- `service_time_query` 表达服务日和日内时间过滤
- `result_limit` 只用于 `departure_list` 与 `timetable`

### `TransportRouteSelector`

```text
TransportRouteSelector
- route_id: str
- service_family: str
- route_variant_query: str
- origin_campus: str
- destination_campus: str
- origin_stop_query: str
- destination_stop_query: str
```

字段语义：

- `route_id`
  - 上游已拥有 canonical route identity 时优先使用
- `service_family`
  - 表达大类，例如地铁接驳车、跨校区通勤车
- `route_variant_query`
  - 保留“丰台线”“海淀返程”“北门接驳”等自由文本别名
- `origin_campus` / `destination_campus`
  - 用于“去丰台”“从丰台回海淀”这类方向性约束
- `origin_stop_query` / `destination_stop_query`
  - 用于站点级约束；如果站点 alias 不唯一，tool 必须 clarification
  - 当两者同时出现时，runtime 必须按 route stop 顺序消歧；只包含两个站但方向相反的 route
    不能保留为同等候选

### `TransportServiceTimeQuery`

```text
TransportServiceTimeQuery
- date_mode:
  - today
  - tomorrow
  - date
- service_date: YYYY-MM-DD
- daypart:
  - morning
  - afternoon
  - evening
  - all_day
- departure_not_before: HH:MM
- departure_not_after: HH:MM
```

字段语义：

- `date_mode` 决定服务日解释
- `service_date` 仅当 `date_mode=date` 时允许出现
- `daypart` 是语义过滤，不替代精确时间边界
- `departure_not_before` / `departure_not_after` 使用校园本地时区 `Asia/Shanghai`
  的 wall-clock 时间，不单独携带时区

## Result Contract

### Frozen Forward Result Shape

```text
TransportScheduleLookupResult
- query_text: str
- intent: same as request
- outcome:
  - resolved_current
  - resolved_historical_reference
  - clarification_required
  - not_found
  - temporarily_unverifiable
- resolved_route: TransportRouteRef | null
- queried_time_anchor: RFC3339 datetime | null
- requested_service_date: YYYY-MM-DD | null
- service_status:
  - running
  - not_running
  - temporarily_suspended
  - limited_service
  - unknown
- selected_departure: ScheduledDeparture | null
- departure_options[]: ScheduledDeparture
- service_window: TransportServiceWindow | null
- schedule_snapshot: TransportScheduleSnapshotRef | null
- timetable_entries[]: ScheduledDeparture
- candidate_routes[]: TransportRouteCandidate
- clarification_reason: str
- stop_refs[]: TransportStopRef
- related_notice_refs[]: str
- operational_notices[]: TransportOperationalNotice
- fail_close_reason:
  - current_state_unverifiable
  - source_truth_unavailable
  - temporal_scope_ambiguous
  - source_family_unavailable
  - source_conflict
```

### `TransportRouteRef`

```text
TransportRouteRef
- route_id: str
- display_name: str
- service_family: str
```

### `ScheduledDeparture`

```text
ScheduledDeparture
- departure_at: RFC3339 datetime
- arrival_at: RFC3339 datetime | null
- origin_stop_ref: TransportStopRef | null
- destination_stop_ref: TransportStopRef | null
```

### `TransportServiceWindow`

```text
TransportServiceWindow
- first_departure_at: RFC3339 datetime | null
- last_departure_at: RFC3339 datetime | null
```

### `TransportScheduleSnapshotRef`

```text
TransportScheduleSnapshotRef
- snapshot_id: str
- published_at: RFC3339 datetime
- effective_from: RFC3339 datetime | null
- effective_until: RFC3339 datetime | null
- source_ref: str
```

### `TransportRouteCandidate`

```text
TransportRouteCandidate
- route: TransportRouteRef
- clarification_hint: str
```

### `TransportOperationalNotice`

```text
TransportOperationalNotice
- notice_id: str
- source_ref: str
- notice_kind: str
- route_ids[]: str
- effective_from: RFC3339 datetime | null
- effective_until: RFC3339 datetime | null
- operational_comment: str
```

固定语义：

- `resolved_route` 表示已收敛到唯一 canonical route；它不是原始 `route_query` 的 echo
- `queried_time_anchor` 记录 runtime 解释 `current/latest/effective/today/tomorrow`
  时使用的可信时间锚点
- `requested_service_date` 是 `service_time_query` 解析后的具体服务日
- `selected_departure` 只用于 `next_departure`、`first_departure`、`last_departure`
- `departure_options` 只用于 `departure_list`
- `service_window` 只用于 `service_window`
- `timetable_entries` 只用于 `timetable`
- `operational_notices` 只承载已经离线物化的 transport operational facts，
  不允许 query-time 回扫通知正文
- `operational_notices.operational_comment` 是唯一允许进入自然语言回答的运营提示字段；
  `notice_id`、`source_ref` 与 raw release locator 只能进入 safe source trace，不得写入正文
- `schedule_snapshot` 在以下情况应出现
  - `schedule_snapshot_metadata`
  - `resolved_historical_reference`
  - 已命中可信 snapshot 但该服务日 / 时段无可用班次的 `not_found`
  - 回答里需要显式暴露所用 snapshot provenance
- `candidate_routes` 只在 `clarification_required` 时出现
- `related_notice_refs` 用于临时停运、限流、节假日调整等与运营状态直接相关的 notice 引用

## Clarification And Outcome Semantics

当前 `clarification_reason` 建议固定为 closed vocabulary：

- `route_family_required`
- `route_direction_required`
- `route_variant_ambiguous`
- `origin_stop_ambiguous`
- `destination_stop_ambiguous`
- `service_date_required`

`outcome` 固定语义：

- `resolved_current`
  - 当前有效 snapshot + 当前或显式服务日下可被当前系统可信回答
- `resolved_historical_reference`
  - 仅当用户显式要求历史版本，例如 `snapshot_query.mode=as_of`
- `clarification_required`
  - 路线、方向、站点或服务日约束不足，不能猜
- `not_found`
  - 已分辨出可信 route / snapshot，但所请求服务日 / 时段没有可用班次
- `temporarily_unverifiable`
  - 当前状态、当前有效 snapshot 或 source truth 不可证，必须 fail-close
  - 请求服务日超出当前 projection 对该 route 的服务日覆盖窗口时，必须使用
    `fail_close_reason=current_state_unverifiable`，不得降级成 `not_found`

## Validation Rules

- `query_text`、`intent` 必填
- `snapshot_query` 必填；未指定时固定为 `TemporalQuery(mode="current")`
- `schedule_snapshot_metadata`
  - 不要求 `route_selector`
  - 不允许 `service_time_query`
- `next_departure`、`first_departure`、`last_departure`
  - 如未能唯一确定路线，必须 `clarification_required`
  - `resolved_*` 时只能填 `selected_departure`，不得同时填 `departure_options` 或
    `timetable_entries`
  - `next_departure` 查询当天且可信当前时间已过最后一班时，返回 `not_found`
  - `first_departure` / `last_departure` 按服务日取首末班，不受可信当前时间过滤
- `departure_list`
  - `resolved_*` 时填 `departure_options`
  - `selected_departure` 必须为空
- `service_window`
  - 优先填 `service_window`
  - 若用户问的是“是否停运/还能不能跑”，允许只填 `service_status` 与
    `related_notice_refs`
  - 如果命中同一路线的乘车点、候车点或路线运营说明，必须填
    `operational_notices` 并把来源并入 `related_notice_refs`
- `timetable`
  - `resolved_*` 时填 `timetable_entries`
  - 路线未收敛时必须 clarification，不默认把全部 route family 展平返回
- `date_mode=date`
  - 必须提供 `service_date`
- `date_mode=today|tomorrow`
  - 不得再传 `service_date`
- `departure_not_before` 不得晚于 `departure_not_after`
- `result_limit`
  - 小于等于 0 时非法
  - `next_departure`、`first_departure`、`last_departure`、`service_window`、
    `schedule_snapshot_metadata` 不消费该字段
- `resolved_historical_reference`
  - `schedule_snapshot` 应出现
  - 只能来自显式历史查询，不得由 current/current-year/current-effective miss 自动触发
- `temporarily_unverifiable`
  - 必须填写 `fail_close_reason`
  - 不得伪造 `selected_departure`、`departure_options`、`service_window` 或
    `timetable_entries`
- trusted current time 只来自 runtime context
  - tool request 不接收“当前时间是多少”这类自由注入字段

## Example Matrix

### 1. 最近的校车时刻表是什么

- 归一化 payload
  - `intent=schedule_snapshot_metadata`
  - `route_selector=null`
  - `snapshot_query.mode=current`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `queried_time_anchor`
  - `schedule_snapshot`
- 必须为空
  - `resolved_route`
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 2. 最近的地铁接驳车时刻表是什么

- 归一化 payload
  - `intent=timetable`
  - `route_selector.service_family=subway_shuttle`
  - `snapshot_query.mode=current`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `schedule_snapshot`
  - `timetable_entries`
- 必须为空
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 3. 最近一版校车时刻表是什么时候发布的

- 归一化 payload
  - `intent=schedule_snapshot_metadata`
  - `route_selector=null`
  - `snapshot_query.mode=current`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `queried_time_anchor`
  - `schedule_snapshot`
- 必须为空
  - `resolved_route`
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 4. 最近一班校车是什么时候

- 归一化 payload
  - `intent=next_departure`
  - `route_selector=null`
  - `snapshot_query.mode=current`
- 预期 outcome
  - `clarification_required`
  - `clarification_reason=route_family_required`
- 必填结果字段
  - `query_text`
  - `intent`
  - `candidate_routes`
  - `clarification_reason`
- 必须为空
  - `resolved_route`
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `schedule_snapshot`
  - `timetable_entries`
  - `fail_close_reason`

### 5. 最近一班去丰台的班车是什么时候

- 归一化 payload
  - `intent=next_departure`
  - `route_selector.destination_campus=fengtai`
  - `snapshot_query.mode=current`
  - `service_time_query.date_mode=today`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `requested_service_date`
  - `service_status`
  - `selected_departure`
- 必须为空
  - `departure_options`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 6. 我明天早上要去丰台上课，最早的班车是几点

- 归一化 payload
  - `intent=first_departure`
  - `route_selector.destination_campus=fengtai`
  - `snapshot_query.mode=current`
  - `service_time_query.date_mode=tomorrow`
  - `service_time_query.daypart=morning`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `requested_service_date`
  - `service_status`
  - `selected_departure`
- 必须为空
  - `departure_options`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 7. 我今天晚上从丰台回海淀，最后一班车是几点

- 归一化 payload
  - `intent=last_departure`
  - `route_selector.origin_campus=fengtai`
  - `route_selector.destination_campus=haidian`
  - `snapshot_query.mode=current`
  - `service_time_query.date_mode=today`
  - `service_time_query.daypart=evening`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `requested_service_date`
  - `service_status`
  - `selected_departure`
- 必须为空
  - `departure_options`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 8. 今天下午 5 点以后去丰台还有哪些班车

- 归一化 payload
  - `intent=departure_list`
  - `route_selector.destination_campus=fengtai`
  - `snapshot_query.mode=current`
  - `service_time_query.date_mode=today`
  - `service_time_query.departure_not_before=17:00`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `requested_service_date`
  - `service_status`
  - `departure_options`
- 必须为空
  - `selected_departure`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 9. 今天这条线的运营时间是什么

- 归一化 payload
  - `intent=service_window`
  - `route_selector.route_id` 继承自上文已解析路线
  - `snapshot_query.mode=current`
  - `service_time_query.date_mode=today`
- 预期 outcome
  - `resolved_current`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `requested_service_date`
  - `service_status`
  - `service_window`
- 必须为空
  - `selected_departure`
  - `departure_options`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 10. 按 2026-04-10 那版时刻表，最早一班是几点

- 归一化 payload
  - `intent=first_departure`
  - `route_selector.route_id` 继承自上文已解析路线
  - `snapshot_query.mode=as_of`
  - `snapshot_query.as_of=2026-04-10`
  - `service_time_query.date_mode=date`
  - `service_time_query.service_date=2026-04-10`
- 预期 outcome
  - `resolved_historical_reference`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `schedule_snapshot`
  - `requested_service_date`
  - `service_status`
  - `selected_departure`
- 必须为空
  - `departure_options`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 11. 当前这条线还能不能跑

- 归一化 payload
  - `intent=service_window`
  - `route_selector.route_id` 继承自上文已解析路线
  - `snapshot_query.mode=current`
  - `service_time_query.date_mode=today`
- 预期 outcome
  - `temporarily_unverifiable`
  - `fail_close_reason=current_state_unverifiable`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `fail_close_reason`
- 必须为空
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `schedule_snapshot`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`

### 12. 去丰台的班车是哪条

- 归一化 payload
  - `intent=timetable`
  - `route_selector.destination_campus=fengtai`
  - `snapshot_query.mode=current`
- 预期 outcome
  - `clarification_required`
  - `clarification_reason=route_variant_ambiguous`
- 必填结果字段
  - `query_text`
  - `intent`
  - `candidate_routes`
  - `clarification_reason`
- 必须为空
  - `resolved_route`
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `schedule_snapshot`
  - `timetable_entries`
  - `fail_close_reason`

### 13. 北门到丰台的班车几点走

- 归一化 payload
  - `intent=next_departure`
  - `route_selector.origin_stop_query=北门`
  - `route_selector.destination_campus=fengtai`
  - `snapshot_query.mode=current`
- 预期 outcome
  - `clarification_required`
  - `clarification_reason=origin_stop_ambiguous`
- 必填结果字段
  - `query_text`
  - `intent`
  - `stop_refs`
  - `clarification_reason`
- 必须为空
  - `resolved_route`
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `schedule_snapshot`
  - `timetable_entries`
  - `candidate_routes`
  - `fail_close_reason`

### 14. 不存在的 XX 专线什么时候发车

- 归一化 payload
  - `intent=next_departure`
  - `route_selector.route_variant_query=XX 专线`
  - `snapshot_query.mode=current`
- 预期 outcome
  - `not_found`
- 必填结果字段
  - `query_text`
  - `intent`
- 必须为空
  - `resolved_route`
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `schedule_snapshot`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

### 15. 今年的校车时刻表没有

- 归一化 payload
  - `intent=timetable`
  - `route_selector.route_id` 继承自上文已解析路线
  - `snapshot_query.mode=current_year`
  - `snapshot_query.year_hint=2026`
- 预期 outcome
  - `temporarily_unverifiable`
  - `fail_close_reason=current_state_unverifiable`
- 必填结果字段
  - `query_text`
  - `intent`
  - `fail_close_reason`
- 必须为空
  - `resolved_route`
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `schedule_snapshot`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`

### 16. 今天地铁接驳车是不是停运了

- 归一化 payload
  - `intent=service_window`
  - `route_selector.service_family=subway_shuttle`
  - `snapshot_query.mode=current`
  - `service_time_query.date_mode=today`
- 预期 outcome
  - `resolved_current`
  - `service_status=temporarily_suspended`
- 必填结果字段
  - `query_text`
  - `intent`
  - `resolved_route`
  - `queried_time_anchor`
  - `requested_service_date`
  - `service_status`
  - `related_notice_refs`
- 必须为空
  - `selected_departure`
  - `departure_options`
  - `service_window`
  - `timetable_entries`
  - `candidate_routes`
  - `clarification_reason`
  - `fail_close_reason`

## Deferred

当前文档明确不冻结：

- 班车 browser card / panel card 的最终前端字段 shape
- map route overlay、geometry polyline 或站点地图交互
- 多 snapshot compare
- 跨 source family 的 live query path
- 用户个性化偏好驱动的默认上车点 / 默认校区注入

## Related Docs

- `docs/architecture/domains/campus-services/architecture.md`
- `docs/domains/campus-services.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/contracts/knowledge-retrieval-plan-contract.md`
