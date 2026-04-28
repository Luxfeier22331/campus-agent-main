---
doc_type: operator-report
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Schedule Batch Preview Execution - 2026-04-28

## Scope

本轮推进第一批 39 条 schedule 通知的 selected-scope 批处理验证与失败项补齐。

本轮执行了：

1. 生成第一批 39 条 schedule 通知的 batch gate。
2. 对首轮 15 条 `auto_stage_candidate` 执行 selected source-truth-only import。
3. 修复 transport schedule materializer 在真实 preview 中暴露的解析问题。
4. 对 5 条图片表格通知写入 selected OCR child documents。
5. 修正 batch gate，使 PDF-only 与 open-ended suspension 不再误入 auto-stage。
6. 基于 clean 13 条 auto-stage selection 重跑 no-write transport preview。

本轮未执行：

- `transport_schedule` selected stage。
- `transport_schedule` promote current pointer。
- structured projection release 写入 PG。
- structured projection release 写入对象存储。
- 39 条以外的全量 notice 重新采集或全量 source-truth 写入。

本轮确实写入了 selected OCR child artifacts：

- source OCR artifacts: `15`
- derived child document artifacts: `10`
- child document registry rows: `5`

这些写入只用于补齐 selected image schedule 表格的 typed materialization 输入，不是
`transport_schedule` release 写入。

## Batch Gate Result

门禁报告：

`./schedule-batch-preview-gate-2026-04-28/schedule-batch-preview-gate.json`

本地 human-readable 报告：

`./schedule-batch-preview-gate-2026-04-28/README.md`

最终分桶结果：

| Bucket | Count |
| --- | ---: |
| `auto_stage_candidate` | 13 |
| `guide_adjacent_split` | 14 |
| `manual_review` | 3 |
| `operational_only` | 4 |
| `already_staged` | 4 |
| `restage_needed` | 1 |
| `blocked` | 0 |

规则修正：

- `245272` 是 PDF-only 附件，且当前没有 body/router schedule evidence，进入
  `manual_review`，原因是 `non_image_attachment_requires_pdf_processing`。
- `354271` 是 `本学期暂停...` open-ended suspension，进入 `operational_only`，原因是
  `open_ended_suspension_notice`。

`restage_needed` 当前只有 `355867`，原因是该 staged release 早于 source notice
release time 时区规范化修复；后续进入 approved release 前需要重 stage。

## Selected Source Truth Import

首轮执行范围：当时 `auto-stage-candidate-selection.json` 中的 15 条 notice。

报告：

`./schedule-batch-preview-gate-2026-04-28/auto-stage-candidate-source-truth-import-report.json`

实际写入性质：

- `source_truth_only`: `true`
- `scope_write_mode`: `upsert_selected`
- `notice_count`: `15`
- `created_document_ids`: `15`
- `raw_uploaded_count`: `15`
- `attachment_fetch_status_rows`: `12`

这一步写入的是 selected source-truth / registry / raw artifact 侧数据，用于让后续
typed materialization 有可解析的父 notice 记录；它不是 `transport_schedule`
release 写入，也没有 stage/promote。

## Materializer Fixes

第一次 no-write preview 暴露出 materializer 质量问题：

- 旧 unbounded baseline 会被继续展开到当前 horizon。
- 停运/暂停通知里的时间会被误抽成 scheduled departure。
- “周六停运，周日正常运营”会把正常运营日误写成停运 exception。

已用回归测试固定并修复：

- `tests/ingestion/test_notice_derived_transport_schedule_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/notice_derived_transport_schedule_materialization.py`

## Failed Item Remediation

首轮 preview gate：

`./schedule-batch-preview-gate-2026-04-28/transport-preview-gate-v2/schedule-transport-preview-gate.json`

结果：

| Bucket | Count |
| --- | ---: |
| `preview_passed` | 8 |
| `preview_failed` | 7 |

7 条 failed 的处理：

| Notice id | Result |
| --- | --- |
| `354578` | 已写入 `attachment-0001:schedule-ocr` child document |
| `354533` | 已写入 `attachment-0001:schedule-ocr` child document |
| `350030` | 已写入 `attachment-0001:schedule-ocr` child document |
| `348880` | 已写入 `attachment-0001:schedule-ocr` child document |
| `247734` | 已写入 `attachment-0001:schedule-ocr` child document |
| `245272` | PDF-only，已渲染本地 page evidence；未写 PDF child，转 manual review |
| `354271` | open-ended suspension，转 operational-only |

OCR child admission 报告：

`./schedule-batch-preview-gate-2026-04-28/failed-image-ocr-child-admission-report.json`

PDF page evidence：

`./schedule-batch-preview-gate-2026-04-28/pdf-page-render-245272/`

## Clean Auto-Stage Preview

clean auto-stage selection：

`./schedule-batch-preview-gate-2026-04-28/auto-stage-candidate-selection.json`

clean projection rebuild 报告：

`./schedule-batch-preview-gate-2026-04-28/clean-auto-stage-projection-rebuild-report.json`

结果：

- `notice_count`: `13`
- `projection_entry_count`: `30`
- `ready_for_target_count`: `13`
- `retained_for_notice_query_count`: `16`
- `pending_multimodal_processing_count`: `1`

no-write preview 报告：

`./schedule-batch-preview-gate-2026-04-28/clean-auto-stage-transport-preview-report.json`

preview work dir：

`./schedule-batch-preview-gate-2026-04-28/clean-auto-stage-preview-work/`

release id：

`transport-schedule-clean-auto-stage-preview-20260428T130000`

validation summary：

| Metric | Count |
| --- | ---: |
| `snapshots` | 13 |
| `scheduled_departures` | 19 |
| `service_exceptions` | 5 |
| `operational_notices` | 0 |
| `rejected_sources` | 0 |

`validation_valid`: `true`

clean preview gate：

`./schedule-batch-preview-gate-2026-04-28/transport-preview-gate-clean-auto-stage/schedule-transport-preview-gate.json`

结果：

| Bucket | Count |
| --- | ---: |
| `preview_passed` | 13 |
| `preview_failed` | 0 |

仍有 `snapshot_only_superseded_baseline` warning 的 5 条：

- `352218`
- `348880`
- `348483`
- `247734`
- `203935`

这些 warning 表示它们只贡献 superseded snapshot，没有当前 horizon departure /
exception / operational output。当前 validation 允许它们存在；selected stage 前仍应确认
release 是否保留这类历史 snapshot。

当前 `transport_schedule` current pointer 已核对，仍为：

```text
transport-schedule-full-ready-20260427T122940
```

## Next Gate

进入 selected write / release 前，只剩两个 release 决策：

1. 是否允许 clean 13 条 selection 中的 5 条 `snapshot_only_superseded_baseline`
   随 release 一起保留。
2. 是否将 `245272` 的 PDF schedule page 纳入后续 PDF child materialization
   专门流程；本轮未把它写入 schedule release。

未获得显式授权前，不进入 multi-notice stage / promote。
