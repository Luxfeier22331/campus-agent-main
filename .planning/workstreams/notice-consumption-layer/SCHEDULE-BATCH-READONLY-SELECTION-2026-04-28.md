---
doc_type: audit
status: draft
created: 2026-04-28
updated: 2026-04-28
---

# Schedule Batch Readonly Selection - 2026-04-28

## Scope

本文件只冻结第一批 schedule 相关通知的只读分流结果。

本次不执行：

- PG writes
- MinIO writes
- derived artifact writes
- source-truth restore
- admission write
- projection / read-model write
- Qdrant / alias publish
- commit

输入只来自当前本地 authenticated notice export bundles：

- `apps/authenticated-notice-collector/runtime/exports/notices-bundle-*.json`
- 当前本地 distinct notice ids: `9665`

## Batch Boundary

这里的 schedule 只表示交通班次与运行安排，对应
`campus_services/transport_schedule` 的候选输入。

本批次纳入：

- `班车`
- `校车`
- `通勤车`
- `接驳车`
- `专车`
- `摆渡车`
- `交通车`

本批次不纳入：

- 课程安排
- 考试安排
- 会议安排
- 岗位津贴报送批次
- 安全工作通知里顺带出现的交通词
- 只在正文深处偶然出现 `班次` / `发车` 的非交通通知

第一批筛选采用 title-level transport signal。正文命中但标题不是交通
schedule 的 notice 暂不进入第一批，避免把 unrelated notices 混入后续处理。

## Summary

只读扫描结果：

| Metric | Count |
| --- | ---: |
| Distinct local notice ids scanned | 9665 |
| First-batch schedule candidates | 39 |
| Schedule / overlay candidates | 34 |
| Operational notice candidates | 3 |
| Schedule review candidates | 2 |
| Candidates with guide-adjacent fields | 15 |
| Candidates with image attachments | 21 |
| Candidates with any attachment | 27 |

按发布时间年份：

| Year | Count |
| --- | ---: |
| 2026 | 9 |
| 2025 | 17 |
| 2024 | 5 |
| 2023 | 3 |
| 2022 | 3 |
| 2021 | 2 |

结论：

- 第一批候选规模是 `39` 条，不是 `9664` / `9665` 全量恢复。
- 这 39 条仍只是 offline candidate set，不是 source-truth、canonical、
  projection 或 serving truth。
- 其中 21 条包含图片附件，后续抽取必须先做只读 evidence inspection /
  extraction dry-run；不能直接把标题或正文摘要写成 timetable facts。
- 15 条含预约、扫码、乘车方式等 guide-adjacent 信息；后续需要拆给
  `service_guide_lookup`，不能把预约说明混入 `transport_schedule_lookup`
  的班次事实。

## Candidate List

### 2026

- `355881` | `2026-04-25 16:26` |
  `schedule_or_overlay_candidate`
  - 标题：关于开通丰台校区社会实践专车的通知
  - 来源部门：后勤保障处（后勤集团）、后勤保障处直属党支部
  - 附件 / 图片：`1 / 1`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `355867` | `2026-04-25 13:11` |
  `schedule_or_overlay_candidate`
  - 标题：关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`3 / 3`
- `355512` | `2026-04-10 12:09` |
  `schedule_or_overlay_candidate`
  - 标题：关于本周六临时增加学生班车班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `355122` | `2026-03-18 11:12` |
  `schedule_or_overlay_candidate`
  - 标题：关于两校区学生通勤班车增加班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `354889` | `2026-03-05 16:50` |
  `schedule_or_overlay_candidate`
  - 标题：关于两校区教师通勤班车班次优化调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `354777` | `2026-02-27 08:06` |
  `schedule_or_overlay_candidate`
  - 标题：关于近期丰台校区周末地铁接驳车运营安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `354578` | `2026-01-21 19:50` |
  `schedule_or_overlay_candidate`
  - 标题：关于寒假期间两校区通勤班车班次调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `354533` | `2026-01-17 18:24` |
  `schedule_or_overlay_candidate`
  - 标题：关于寒假期间两校区通勤班车运营安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `354505` | `2026-01-15 09:58` |
  `schedule_or_overlay_candidate`
  - 标题：关于近期地铁接驳车运营安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`

### 2025

- `354271` | `2025-12-30 17:46` |
  `schedule_or_overlay_candidate`
  - 标题：关于本学期暂停周五18:00由丰台校区发往五棵松地铁站接驳车的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `354270` | `2025-12-30 10:01` |
  `schedule_review_candidate`
  - 标题：关于两校区通勤班车新增班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `353903` | `2025-12-11 16:02` |
  `operational_notice_candidate`
  - 标题：关于更改通勤班车丰台校区乘车点的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `353901` | `2025-12-11 15:40` |
  `schedule_review_candidate`
  - 标题：关于两校区通勤班车新增班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `352325` | `2025-09-25 17:06` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区地铁接驳车优化调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`3 / 3`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `352218` | `2025-09-19 20:41` |
  `schedule_or_overlay_candidate`
  - 标题：关于两校区师生通勤班车运营时间的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `351862` | `2025-09-04 20:30` |
  `operational_notice_candidate`
  - 标题：关于本周末临时更改地铁接驳车校内乘车点的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `351696` | `2025-08-28 16:54` |
  `schedule_or_overlay_candidate`
  - 标题：关于本学期两校区通勤班车及地铁接驳车恢复运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`3 / 3`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `351030` | `2025-07-08 09:28` |
  `schedule_or_overlay_candidate`
  - 标题：关于暑假期间师生通勤班车、地铁接驳车运营调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `350030` | `2025-07-03 18:08` |
  `schedule_or_overlay_candidate`
  - 标题：关于通勤班车每周增加临时班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `349494` | `2025-04-24 22:16` |
  `schedule_or_overlay_candidate`
  - 标题：关于近期两校区通勤班车及地铁接驳车安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`4 / 4`
- `348880` | `2025-03-28 17:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于两校区师生通勤班车运营时间的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `348483` | `2025-03-07 12:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于两校区师生通勤班车优化调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `348457` | `2025-03-07 08:30` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区地铁接驳车优化调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`6 / 6`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `348272` | `2025-02-25 17:00` |
  `schedule_or_overlay_candidate`
  - 标题：关于通勤班车、地铁接驳车相关调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `248186` | `2025-02-18 17:35` |
  `schedule_or_overlay_candidate`
  - 标题：关于2025年春季学期两校区通勤班车及地铁接驳车安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `247970` | `2025-01-11 21:50` |
  `schedule_or_overlay_candidate`
  - 标题：关于近期通勤班车、地铁接驳车运营时间调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`

### 2024

- `247734` | `2024-12-29 10:38` |
  `schedule_or_overlay_candidate`
  - 标题：关于增加两校区学生通勤班车班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 1`
- `245395` | `2024-09-05 15:39` |
  `schedule_or_overlay_candidate`
  - 标题：关于本周六丰台校区地铁接驳车暂停运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `245272` | `2024-08-30 08:48` |
  `schedule_or_overlay_candidate`
  - 标题：关于2024年秋季学期两校区学生通勤班车运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 0`
- `245271` | `2024-08-29 20:47` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区2024年秋季学期周末及节假日地铁接驳车运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`1 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `244214` | `2024-06-07 17:08` |
  `schedule_or_overlay_candidate`
  - 标题：关于通勤班车周末及法定节假日增加班次的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息

### 2023

- `237479` | `2023-11-11 15:55` |
  `operational_notice_candidate`
  - 标题：关于优化两校区学生通勤班车方案的通知（试行）
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`3 / 1`
- `233383` | `2023-09-15 22:21` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区2023年秋季学期周末及节假日地铁接驳车安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`2 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `228282` | `2023-02-23 14:58` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区2023年春季学期周末及节假日地铁接驳车运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息

### 2022

- `203935` | `2022-10-27 10:25` |
  `schedule_or_overlay_candidate`
  - 标题：关于中央民族大学丰台校区周末地铁接驳车运营时间调整的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
- `202713` | `2022-09-22 14:35` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区2022年秋季学期周末及节假日地铁接驳车运营的通知
    （9月24-25日试运行）
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`2 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `196321` | `2022-02-27 10:28` |
  `schedule_or_overlay_candidate`
  - 标题：关于2022年2月28日～3月20日期间丰台校区—海淀校区通勤班车安排的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`0 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息

### 2021

- `192180` | `2021-09-29 10:08` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区与篱笆房地铁站接驳车试运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`2 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息
- `192087` | `2021-09-25 16:15` |
  `schedule_or_overlay_candidate`
  - 标题：关于丰台校区与篱笆房地铁站接驳车试运营的通知
  - 来源部门：丰台校区管理委员会
  - 附件 / 图片：`2 / 0`
  - 备注：含预约/乘车方式字段，后续需拆 guide-adjacent 信息

## Held Out Of First Batch

以下类型仅作为 hold，不进入第一批：

- broader keyword scan 中的 weak body-only hits
- 标题不含交通班次词，但正文偶然出现 `班次` / `发车` 的通知
- 课程、考试、岗位津贴、安全、共享单车、校园通行类 notice
- 需要先判断是否属于 `service_status_lookup`、`service_guide_lookup` 或
  `notice-agent` 的边界案例

示例：

- 研究生课程安排通知
- 考试期间学校东西门通行通知
- 大风极端天气安全工作通知
- 研究生助管、助研岗位津贴确认通知
- 共享单车入驻通知

## Next Readonly Work

下一步仍然只读：

1. 对 39 条 candidate 生成 extraction dry-run report。
2. 标出每条 candidate 的 route mapping：
   - `route:haidian-to-fengtai`
   - `route:fengtai-to-haidian`
   - `route:subway-shuttle`
   - `route:fengtai-to-wukesong-subway`
   - `route:wukesong-subway-to-fengtai`
3. 标出每条 candidate 的 source kind：
   - baseline revision
   - temporary period overlay
   - exception / suspension
   - boarding point change
   - guide-adjacent only
4. 对 21 条 image-bearing candidate，只做本地 evidence inventory，不写 OCR /
   multimodal result。
5. 输出人工确认用 manifest；确认前不进入 source-truth、projection 或 read-model。
