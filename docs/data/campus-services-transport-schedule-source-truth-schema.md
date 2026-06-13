---
doc_type: data
truth_scope: data
owner_boundary: domains/campus-services
status: active
created: 2026-04-24
updated: 2026-04-28
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
`authenticated_notice_portal` notice 经过 `notice_consumption_projection` 显式准入后的
ready transport candidates。

固定规则：

- `authenticated_notice_portal` 仍是 source-channel owner；本文不创建新的 source
  channel
- `notice_consumption_projection` 是 transport schedule 下游物化的准入边界；builder
  不得在下游重新扫描全部 notice inventory
- `campus_services/transport_schedule` 是下游 structured projection owner，不是
  generic retrieval collection
- 班次时间、停运、临时调整必须有 notice provenance
- route / stop canonical seed 由 repo config/code 持有；具体班次事实不得无来源手写
- builder 离线展开 baseline 的 90 天服务日；bounded temporary overlay 按显式服务日期范围展开，
  Go runtime 不持有 recurrence parser
- 对象存储保存 immutable versioned projection artifact；长期 online consumption 通过
  PostgreSQL release catalog、current pointer 与 typed transport schedule read model
  完成
- selected-write/release workflow 必须先做 bounded selected export、consumer admission
  gate、local preview，再进入 stage 或 promote；不得从全部 notice bundle 直接写 current
- mounted current file 只属于 bootstrap / smoke compatibility，不是长期 production
  consumption truth
- no-write transport preview gate 必须输出 release write plan，至少区分
  `current_serving_write`、`historical_snapshot_only_write`、
  `operational_exception_write` 与 `preview_failed_skip`
- `snapshot_only_superseded_baseline` 只允许用于非 current、无服务日期范围的
  `baseline_revision` snapshot；它表示该 notice 只贡献历史快照，不贡献当前 serving
  row。current snapshot 如果没有 `scheduled_departures`、`service_exceptions` 或
  `operational_notices`，必须阻断 preview / release

## Input Source Truth

输入来自 authenticated notice consumption projection 中的 ready transport candidate：

- `target_surface=campus_services/service_status_candidate`
- `consumption_status=ready_for_target_materialization`
- `role_metadata.service_status_candidate_kind=transport_schedule`

每个 projection entry 必须保留 parent notice provenance，并可携带 OCR 子文档引用：

- `source_notice_document_id`
- `source_notice_id`
- `source_attachment_ref_ids`
- `role_metadata.attachment_document_ids`

OCR 子文档只从 derived canonical artifacts 读取：

- `document-units.jsonl`
- `canonical.md`

其中表格抽取优先使用 `document-units.jsonl` 的结构化 `table_cells`；当 OCR/provider
只产出 `html` / `table_html`、Markdown pipe table 或以制表符 / 多空格对齐的正文表格时，
builder 可以把这些形态规范化为同一 table matrix 后再做领域清洗，例如 merged-cell
fill-down、方向归一化、时间归一化和年内生效日补齐。

legacy inventory 模式仍可用于早期 source-truth parent smoke，但不是首选生产路径。
该模式输入来自 authenticated notice source-truth inventory 中的 parent notice。

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

第一版固定九条 route identity：

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
- `route:fengtai-to-wukesong-subway`
  - display name: `丰台到五棵松地铁接驳车`
  - service family: `subway_shuttle`
  - default calendar: daily
- `route:wukesong-subway-to-fengtai`
  - display name: `五棵松到丰台地铁接驳车`
  - service family: `subway_shuttle`
  - default calendar: daily
- `route:fengtai-to-libafang-subway`
  - display name: `丰台到篱笆房地铁接驳车`
  - service family: `subway_shuttle`
  - default calendar: daily
- `route:libafang-subway-to-fengtai`
  - display name: `篱笆房到丰台地铁接驳车`
  - service family: `subway_shuttle`
  - default calendar: daily
- `route:fengtai-to-zhangguozhuang-special-bus`
  - display name: `丰台到张郭庄社会实践专车`
  - service family: `temporary_special_bus`
  - default calendar: daily
- `route:yuanboyuan-to-fengtai-special-bus`
  - display name: `园博园到丰台社会实践专车`
  - service family: `temporary_special_bus`
  - default calendar: daily

站点第一版只保留 route-level stop refs，用于回答与后续 navigation handoff：

- `stop:haidian-east-gate`
- `stop:fengtai-main-gate`
- `stop:subway-station`
- `stop:fengtai-juyacanting-parking-lot`
- `stop:wukesong-subway-a-north`
- `stop:fengtai-student-activity-center-west-parking-lot`
- `stop:libafang-subway-b2`
- `stop:fengtai-smart-center-south`
- `stop:zhangguozhuang-subway-14`
- `stop:yuanboyuan-subway-a-west-50m`
- `stop:fengtai-campus`

如果 notice 文本中的路线、方向或站点无法稳定映射到上述 identity，builder 必须把该
source 写入 rejected-source report，不得猜测写入 current projection。

## Projection Bundle

生成 artifact 固定为 `campus_services_projection_bundle.v1`。

顶层字段：

- `schema_version`
- `service_status_records`
- `transport_schedule_snapshots`
- `transport_routes`
- `scheduled_departures`
- `transport_service_exceptions`
- `transport_operational_notices`
- `transport_rejected_sources`
- `transport_release_notices`

`transport_schedule_snapshots` 保存版本与来源：

- `snapshot_id`
- `published_at`
- `effective_from`
- `effective_until`
- `source_ref`
- `is_current`
- `schedule_scope`
  - `baseline_revision`
  - `temporary_period`
  - `temporary_period_revision`
  - `exception_status`
- `service_date_ranges`
  - `start_date`
  - `end_date`
- `precedence`

`is_current=true` 只表示当前 baseline snapshot。临时调整、寒暑假班次、周末接驳等
bounded overlay 不通过 `is_current` 表示有效性，而是通过
`service_date_ranges + precedence` 在 `transport_schedule_lookup` 中按 requested
service date 覆盖 baseline。范围外查询必须回落到 current baseline。

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

`transport_operational_notices` 保存不改变班次表、但会影响乘坐方式或路线说明的运行通知：

- `notice_id`
- `source_ref`
- `notice_kind`
  - `boarding_point_change`
- `route_ids`
- `effective_from`
- `effective_until`
- `operational_comment`

`transport_rejected_sources` 保存已准入但未物化为 schedule / exception /
operational notice 的候选：

- `schema_version`
- `source_notice_id`
- `source_ref`
- `reason`
- `candidate_kind`

`transport_release_notices` 保存当前 release 消费过的 notice provenance：

- `source_notice_id`
- `source_ref`
- `source_notice_release_time`
- `admitted_at`
- `materialized_at`

## Publication

发布模式固定为三档：

- `preview`
  - 只写本地 release artifacts
  - 不写对象存储
  - 不写 PostgreSQL release catalog / typed read model
  - 不移动 current pointer
- `stage`
  - 写 immutable versioned artifacts
  - 写 PostgreSQL release catalog 与 typed read model
  - 不写 current artifact
  - 不移动 `structured_projection_current`
- `promote`
  - 写 immutable versioned artifacts
  - 写 compatibility current artifact
  - 写 PostgreSQL release catalog 与 typed read model
  - 事务性移动 `structured_projection_current`

single-notice 或 selected batch 验证必须先使用 `preview`；需要保留写入证据但不能影响线上查询时使用
`stage`；只有完整、已批准的当前时刻表 release 可以使用 `promote`。

`stage` 或 `promote` 前必须先运行 no-write transport preview gate。gate 的
`preview-passed-selection.json` 是后续 selected release 的唯一允许输入；
`release-write-plan.json` 只作为同一批 release 内的写入解释与审计分桶，不能把
`historical_snapshot_only_write` 单独拿去 promote 为当前时刻表。

`historical_snapshot_only_write` 的写入语义：

- 写入 `transport_schedule_snapshots` 与 `transport_release_notices`
- 保留原始 notice / OCR / attachment provenance
- `is_current=false`
- `service_date_ranges=[]`
- 不写入当前 `scheduled_departures`
- 不写入 `transport_service_exceptions`
- 不写入 `transport_operational_notices`

versioned artifact：

`campus_services/releases/transport_schedule/{release_id}/campus-services-projection.json`

compatibility current artifact 只允许 `promote` 写入：

`campus_services/releases/transport_schedule/current/campus-services-projection.json`

伴随 artifact：

- `validation-summary.json`
- `release-manifest.json`
- `rejected-source-report.json`

local / smoke runtime 与 production runtime 都通过 PostgreSQL
`structured_projection_current` current pointer 和 typed read model 消费当前 release；
mounted readonly current projection file runtime 已下线。

长期 production publication 必须同时写入 PostgreSQL：

- release catalog：记录 `release_id`、schema、artifact object key、checksum、counts、
  validation status 与 source notice provenance
- current pointer：事务性指向当前 `(campus_services, transport_schedule)` release
- typed read model：按 `release_id` 保存 routes、snapshots、scheduled departures、
  service exceptions、operational notices、rejected sources 与 release-notice
  provenance

`transport_release_notices` typed read model 必须保留：

- `source_notice_id`
- `source_notice_release_time`
- `admitted_at`
- `materialized_at`

Go `apps/execution-control` 长期不直接读对象存储、不持有对象存储凭据，也不在 query-time
解析 projection JSON。它通过 projection-backed internal query service 读取 PG current
release 与 typed read model。

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
- bounded overlay 缺 `service_date_ranges`

以下情况进入 rejected-source report，不写入 current projection：

- notice 含校车/班车关键词但缺生效日
- route / direction 无法映射到 canonical route seed
- 文本没有可稳定抽取的发车时间
- 临时调整没有明确服务日

## Opening Gate

补齐本 schema 与 builder 只表示 data plane 具备真实 projection backing。产品主路径仍保持
gate-closed，直到 release-gate regression、eval evidence 与 app-owned typed
observability summary 同时满足。
