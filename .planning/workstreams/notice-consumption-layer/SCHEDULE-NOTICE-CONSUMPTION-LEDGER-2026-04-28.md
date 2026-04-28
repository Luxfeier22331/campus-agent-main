---
doc_type: operator-ledger
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Schedule Notice Consumption Ledger - 2026-04-28

## Operating Rules

本 ledger 只记录第一批 `schedule` 类通知的逐条消费进展。每一条 notice
必须先完成独立评估，再进入 selected write / stage。禁止把第一批 39 条直接
bulk 写入 projection 或 current。

当前 selected-write 规则：

- `preview`：允许使用单条 notice，也允许只读检查 all-ready transport candidates。
- `stage`：默认只允许一条 selected notice；多 notice stage 必须显式
  `--allow-multi-notice-release`，并且每条已在本 ledger 独立评估。
- `promote`：不在本批逐条处理流程中使用；只有完整 approved release 才能 promote。
- `structured_projection_current` 必须在逐条 stage 后保持不变，除非用户明确批准 promote。
- `transport_release_notices` 必须记录 source notice id、source notice release time、
  admission time 与 materialization time；source notice release time 需要写入带时区
  的 Shanghai local ISO timestamp。

## Batch Scope

候选集来自
`.planning/workstreams/notice-consumption-layer/SCHEDULE-BATCH-READONLY-SELECTION-2026-04-28.md`。

第一批共 39 条：

<!-- markdownlint-disable MD013 -->

| Notice id | Year | Initial class | Consumption state |
| --- | ---: | --- | --- |
| `355881` | 2026 | schedule_or_overlay_candidate | staged selected release |
| `355867` | 2026 | schedule_or_overlay_candidate | staged selected release |
| `355512` | 2026 | schedule_or_overlay_candidate | staged selected release |
| `355122` | 2026 | schedule_or_overlay_candidate | staged selected release |
| `354889` | 2026 | schedule_or_overlay_candidate | staged selected release |
| `354777` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
| `354578` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
| `354533` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
| `354505` | 2026 | schedule_or_overlay_candidate | pending independent evaluation |
| `354271` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `354270` | 2025 | schedule_review_candidate | pending independent evaluation |
| `353903` | 2025 | operational_notice_candidate | pending independent evaluation |
| `353901` | 2025 | schedule_review_candidate | pending independent evaluation |
| `352325` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `352218` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `351862` | 2025 | operational_notice_candidate | pending independent evaluation |
| `351696` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `351030` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `350030` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `349494` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `348880` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `348483` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `348457` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `348272` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `248186` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `247970` | 2025 | schedule_or_overlay_candidate | pending independent evaluation |
| `247734` | 2024 | schedule_or_overlay_candidate | pending independent evaluation |
| `245395` | 2024 | schedule_or_overlay_candidate | pending independent evaluation |
| `245272` | 2024 | schedule_or_overlay_candidate | pending independent evaluation |
| `245271` | 2024 | schedule_or_overlay_candidate | pending independent evaluation |
| `244214` | 2024 | schedule_or_overlay_candidate | pending independent evaluation |
| `237479` | 2023 | operational_notice_candidate | pending independent evaluation |
| `233383` | 2023 | schedule_or_overlay_candidate | pending independent evaluation |
| `228282` | 2023 | schedule_or_overlay_candidate | pending independent evaluation |
| `203935` | 2022 | schedule_or_overlay_candidate | pending independent evaluation |
| `202713` | 2022 | schedule_or_overlay_candidate | pending independent evaluation |
| `196321` | 2022 | schedule_or_overlay_candidate | pending independent evaluation |
| `192180` | 2021 | schedule_or_overlay_candidate | pending independent evaluation |
| `192087` | 2021 | schedule_or_overlay_candidate | pending independent evaluation |

<!-- markdownlint-enable MD013 -->

## Completed Independent Evaluations

### `355867`

- 标题：关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知
- 发布时间：`2026-04-25 13:11`
- Evidence：3 个 schedule image OCR attachment units admitted；正文无可直接抽取 schedule body。
- 结论：真实 timetable 输入，属于 bounded temporary period / overlay。
- Stage release：`transport-schedule-355867-stage-20260428T005620Z`
- Stage counts：snapshots `1`，scheduled departures `49`，routes `9`，
  service exceptions `0`，operational notices `0`，rejected sources `0`。
- PG release row：`validation_status=valid`，
  `source_notice_ids={notice:muc_internal_portal:355867}`。
- PG provenance row count：`1`。
- Current pointer after stage：`transport-schedule-full-ready-20260427T122940`。
- Note：该 staged release 早于 source notice release time 时区规范化修复；后续如要纳入
  approved release，必须基于可复核 admission manifest 重新 stage，不直接 promote 此 staged id。

### `355881`

- 标题：关于开通丰台校区社会实践专车的通知
- 发布时间：`2026-04-25 16:26`
- Evidence：image OCR rejected as low-confidence visual/mixed image；正文 schedule extractor
  extracted 7 rows and service window `4月28日-30日之间`。
- 结论：不是 baseline intercampus commute；是 bounded temporary special bus for social
  practice week。预约、扫码、乘车方式属于 guide-adjacent，不混入 schedule facts。
- Extracted routes：
  - `route:fengtai-to-zhangguozhuang-special-bus`: `07:30`, `09:00`, `10:30`, `12:00`
  - `route:yuanboyuan-to-fengtai-special-bus`: `18:00`, `19:30`, `21:00`
- Service date range：`2026-04-28` 到 `2026-04-30`
- Stage release：`transport-schedule-355881-stage-20260428T012432Z`
- Stage counts：snapshots `1`，scheduled departures `7`，routes `9`，
  service exceptions `0`，operational notices `0`，rejected sources `0`。
- PG release row：`validation_status=valid`，
  `source_notice_ids={notice:muc_internal_portal:355881}`。
- PG provenance row count：`1`。Source notice release time 已按 `2026-04-25T16:26:00+08:00`
  语义写入 typed PG row（Postgres 显示为等价 UTC `2026-04-25 08:26:00+00`）。
- Current pointer after stage：`transport-schedule-full-ready-20260427T122940`。

### `355512`

- 标题：关于本周六临时增加学生班车班次的通知
- 发布时间：`2026-04-10 12:09`
- Evidence：无附件；正文明确写明本周六（4月11日）丰台校区发往海淀校区的
  通勤班车临时增加一趟 `6:40` 学生班次。
- Admission：selected bundle
  `/tmp/schedule-355512-20260428T023023Z/selected-355512.json`；consumer
  admission manifest 分类为 `transport_commute_status` ->
  `campus_services/service_status_candidate`，无 attachment / multimodal /
  owner gap。
- 结论：真实 timetable 输入；bounded temporary period overlay，不是 baseline
  revision；没有 guide-adjacent 字段。
- Preview：`transport-schedule-355512-preview-20260428T023600Z`，本地 only。
- Stage release：`transport-schedule-355512-stage-20260428T023900Z`
- Stage counts：snapshots `1`，scheduled departures `1`，routes `9`，
  service exceptions `0`，operational notices `0`，rejected sources `0`。
- Extracted route：`route:fengtai-to-haidian`，departure `06:40`，service date
  `2026-04-11`，related notice `notice:muc_internal_portal:355512`。
- PG release row：`validation_status=valid`，
  `source_notice_ids={notice:muc_internal_portal:355512}`。
- PG provenance row count：`1`。Source notice release time 已按
  `2026-04-10T12:09:00+08:00` 语义写入 typed PG row（Postgres 显示为等价 UTC
  `2026-04-10 04:09:00+00`）。
- Current pointer after stage：`transport-schedule-full-ready-20260427T122940`。

### `355122`

- 标题：关于两校区学生通勤班车增加班次的通知
- 发布时间：`2026-03-18 11:12`
- Evidence：正文明确说明 `3月20日（本周五）起` 两校区学生通勤班车增加 2 个
  班次，具体时刻表在 1 张 inline image；parser-v3 OCR child document
  `notice_attachment:muc_internal_portal:355122:attachment-0001:schedule-ocr`
  admitted，confidence `medium`，table count `1`。
- Admission：selected bundle
  `/tmp/schedule-355122-20260428T023921Z/selected-355122.json`；consumer
  admission manifest 分类为 `transport_commute_status` ->
  `campus_services/service_status_candidate`。本条先暴露出 OCR child document id
  使用非 canonical `attachment-1` 的问题；已修复为 source-truth canonical
  `attachment-0001`，并清理本次错误写入的 registry row 后重建 selected projection。
- 结论：真实 timetable 输入；baseline revision，自 `2026-03-20` 起生效；不是
  temporary overlay。正文里没有预约、扫码、guide-adjacent 字段。
- Preview：`transport-schedule-355122-preview-20260428T025739Z`，本地 only。
- Stage release：`transport-schedule-355122-stage-20260428T025821Z`
- Stage counts：snapshots `1`，scheduled departures `32`，routes `9`，
  service exceptions `0`，operational notices `0`，rejected sources `0`。
- Extracted新增班次：
  - `route:fengtai-to-haidian`，departure `07:30`，周一至周五，学生班次
  - `route:haidian-to-fengtai`，departure `19:30`，周一至周五，学生班次
- Snapshot：`effective_from=2026-03-20T00:00:00+08:00`，
  `schedule_scope=baseline_revision`，`published_at=2026-03-18T11:12:00+08:00`。
- PG release row：`validation_status=valid`，
  `source_notice_ids={notice:muc_internal_portal:355122}`。
- PG provenance row count：`1`。Source notice release time 已按
  `2026-03-18T11:12:00+08:00` 语义写入 typed PG row（Postgres 显示为等价 UTC
  `2026-03-18 03:12:00+00`）。
- Current pointer after stage：`transport-schedule-full-ready-20260427T122940`。

### `354889`

- 标题：关于两校区教师通勤班车班次优化调整的通知
- 发布时间：`2026-03-05 16:50`
- Evidence：正文明确说明 `3月9日（下周一）起` 对丰台校区发往海淀校区的
  两趟教师班车发车时间进行优化调整，具体时刻表在 1 张 inline image；parser-v3
  OCR child document
  `notice_attachment:muc_internal_portal:354889:attachment-0001:schedule-ocr`
  admitted，confidence `medium`，table count `1`。
- Manual image review：原图仅两行红色调整备注：
  - `13:00` 教师班次：原 `12:45` 调整为 `13:00`
  - `13:30` 教师班次：原 `13:15` 调整为 `13:30`
- Parser fixes applied before stage：表格发车时间只从整格发车时间单元格提取，不从备注
  里的“原时间”泛扫；`发车时间由原 X 调整为 Y` 备注只在本行 departure time 等于
  `Y` 时保留，避免 OCR 把红色备注复制到后续行造成污染。
- Admission：selected bundle
  `/tmp/schedule-354889-20260428T030411Z/selected-354889.json`；consumer
  admission manifest 分类为 `transport_commute_status` ->
  `campus_services/service_status_candidate`。
- 结论：真实 timetable 输入；baseline revision，自 `2026-03-09` 起生效；不是
  temporary overlay。正文里没有预约、扫码、guide-adjacent 字段。
- Preview：`transport-schedule-354889-preview-20260428T030820Z`，本地 only。
- Stage release：`transport-schedule-354889-stage-20260428T030903Z`
- Stage counts：snapshots `1`，scheduled departures `30`，routes `9`，
  service exceptions `0`，operational notices `0`，rejected sources `0`。
- Adjusted departures：
  - `route:fengtai-to-haidian`，departure `13:00`，周一至周五，教师班次，
    原 `12:45` 调整为 `13:00`
  - `route:fengtai-to-haidian`，departure `13:30`，周一至周五，教师班次，
    原 `13:15` 调整为 `13:30`
- Snapshot：`effective_from=2026-03-09T00:00:00+08:00`，
  `schedule_scope=baseline_revision`，`published_at=2026-03-05T16:50:00+08:00`。
- PG release row：`validation_status=valid`，
  `source_notice_ids={notice:muc_internal_portal:354889}`。
- PG provenance row count：`1`。Source notice release time 已按
  `2026-03-05T16:50:00+08:00` 语义写入 typed PG row（Postgres 显示为等价 UTC
  `2026-03-05 08:50:00+00`）。
- Current pointer after stage：`transport-schedule-full-ready-20260427T122940`。

## Remaining Gaps To Close Per Notice

- 对剩余 34 条逐条判断：`transport_schedule` / `operational_notice` /
  `service_guide_adjacent` / `hold`。
- 对 image-bearing notice，只消费 admitted schedule-table OCR child documents；
  rejected visual/guide images 不写入 schedule facts。
- 对正文可解析 notice，必须把预约入口、预约开放时间、扫码/签到说明与 timetable facts 拆开。
- 对 schedule_review_candidate，必须先确认是否与更新 notice 重复或被后续 notice 覆盖。
- 对 operational_notice_candidate，仅写 boarding point / suspension / operation note，
  不伪造成 timetable row。
