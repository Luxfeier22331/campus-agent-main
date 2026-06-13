---
doc_type: contract
truth_scope: capability
owner_boundary: domains/campus-services
status: active
created: 2026-06-13
updated: 2026-06-13
---
# Transport Schedule Lookup Examples

<!-- markdownlint-disable MD013 -->

## Document Boundary

This appendix owns the stable example matrix for
`transport_schedule_lookup`. The main contract owns request/result shape,
validation rules and outcome semantics.

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
