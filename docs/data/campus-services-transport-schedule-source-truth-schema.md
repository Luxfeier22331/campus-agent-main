---
doc_type: data
status: active
created: 2026-04-24
updated: 2026-04-24
---
# Campus Services Transport Schedule Source-Truth Schema

## 文档边界

本文冻结 `campus_services/transport_schedule` 第一版 projection 的 source-truth 消费与
artifact schema。

它回答：

- 真实校车时刻表 projection 第一版消费哪些上游 source truth
- authenticated notice source truth 如何被抽取为 route / stop / departure /
  exception
- `campus_services_projection_bundle.v1` 的生成、校验与发布边界
- Go structured query runtime 如何消费 current projection

它不覆盖：

- `transport_schedule_lookup` 的 request/result contract
- official_web 校车页面采集与解析
- browser-facing card payload
- 产品主路径 opening gate

## Core Conclusion

第一版真实 transport schedule projection 只消费
`authenticated_notice_portal` notice source truth。

固定规则：

- `authenticated_notice_portal` 仍是 source-channel owner；本文不创建新的 source
  channel
- `campus_services/transport_schedule` 是下游 structured projection owner，不是
  generic retrieval collection
- 班次时间、停运、临时调整必须有 notice provenance
- route / stop canonical seed 由 repo config/code 持有；具体班次事实不得无来源手写
- builder 离线展开 90 天服务日；Go runtime 不持有 recurrence parser
- 对象存储保存 versioned/current projection truth；Docker runtime 只读 mounted current
  file

## Input Source Truth

输入来自 authenticated notice source-truth inventory 中的 parent notice。

每个 parent 至少需要：

- `notice_manifest`
  - `site_id`
  - `notice_id`
  - `notice_title_normalized`
  - `notice_release_time`
  - `source_notice_link`
- `content_blocks`
  - `text_normalized`
  - `text_raw`

CLI 也允许 inventory parent 使用 object key 引用：

- `notice_manifest_key`
- `content_blocks_key`

对象 key 指向 canonical authenticated notice source-truth artifacts，而不是 collector
export、raw HTML 或附件 OCR 输出。

## Route Canonical Seed

第一版固定三条 route identity：

- `route:haidian-to-fengtai`
  - display name: `海淀到丰台通勤车`
  - service family: `intercampus_commute`
  - default calendar: weekdays
- `route:fengtai-to-haidian`
  - display name: `丰台到海淀通勤车`
  - service family: `intercampus_commute`
  - default calendar: weekdays
- `route:subway-shuttle`
  - display name: `地铁接驳车`
  - service family: `subway_shuttle`
  - default calendar: daily

站点第一版只保留 route-level stop refs，用于回答与后续 navigation handoff：

- `stop:haidian-east-gate`
- `stop:fengtai-main-gate`
- `stop:subway-station`

如果 notice 文本中的路线、方向或站点无法稳定映射到上述 identity，builder 必须把该
source 写入 manual-review report，不得猜测写入 current projection。

## Projection Bundle

生成 artifact 固定为 `campus_services_projection_bundle.v1`。

顶层字段：

- `schema_version`
- `service_status_records`
- `transport_schedule_snapshots`
- `transport_routes`
- `scheduled_departures`
- `transport_service_exceptions`

`transport_schedule_snapshots` 保存版本与来源：

- `snapshot_id`
- `published_at`
- `effective_from`
- `effective_until`
- `source_ref`
- `is_current`

`scheduled_departures` 保存已展开的服务日：

- `snapshot_id`
- `route_id`
- `service_dates`
- `departure_time`
- `arrival_time`
- `origin_stop_id`
- `destination_stop_id`
- `related_notice_refs`
- `operational_comment`

`transport_service_exceptions` 覆盖基础班次：

- `snapshot_id`
- `route_id`
- `service_date`
- `service_status`
- `related_notice_refs`
- `operational_comment`

## Publication

versioned artifact：

`campus_services/releases/transport_schedule/{release_id}/campus-services-projection.json`

current artifact：

`campus_services/releases/transport_schedule/current/campus-services-projection.json`

伴随 artifact：

- `validation-summary.json`
- `release-manifest.json`
- `manual-review-report.json`

`SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH` 指向 Docker runtime 内 mounted readonly
current projection file。Go `apps/supervisor-api` 不直接读对象存储，不持有对象存储凭据。

## Validation

以下情况必须阻断发布：

- `schema_version` 不匹配
- 多个 current snapshot
- 有 snapshot 但没有 current snapshot
- snapshot 缺 `source_ref`、`published_at` 或非法 RFC3339 时间
- departure 引用不存在的 snapshot / route / stop
- departure time 不是 `HH:MM`
- service date 不是 `YYYY-MM-DD`
- exception 引用不存在的 snapshot / route
- related notice ref 无法回链到 snapshot source refs

以下情况进入 manual review，不写入 current projection：

- notice 含校车/班车关键词但缺生效日
- route / direction 无法映射到 canonical route seed
- 文本没有可稳定抽取的发车时间
- 临时调整没有明确服务日

## Opening Gate

补齐本 schema 与 builder 只表示 data plane 具备真实 projection backing。产品主路径仍保持
gate-closed，直到 release-gate regression、eval evidence 与 app-owned typed
observability summary 同时满足。
