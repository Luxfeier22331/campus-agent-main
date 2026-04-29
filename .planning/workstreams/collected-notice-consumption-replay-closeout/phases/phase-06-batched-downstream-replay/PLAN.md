---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Batched Downstream Replay

## Goal

对已设计好的目标分批进入下游消费，不让未设计内容自动晋升。

## Current Slice

先执行单条 notice pilot，再决定是否扩大到 target batch。当前 pilot 固定为：

- `source_notice_id`: `355512`
- title: `关于本周六临时增加学生班车班次的通知`
- target: `transport_schedule`
- admission posture: no-write dry-run, no current promotion

选择理由：

- Phase 4 searchable preview 中存在完整正文与 source object refs。
- Phase 5 multimodal status 为 `not_required`，不依赖未完成 OCR。
- 正文包含可结构化的路线、时间与服务日期：`丰台校区 -> 海淀校区`、`06:40`、`2026-04-11`。

本 slice 先验证 `source -> searchable unit -> target admission -> stage candidate`
的回链和 no-write 语义，再扩到 `transport_schedule` target batch。

Phase 6 后续已拆分：

- queue-backed ingest gap 先由 Phase 4.5 / 4.6 / 4.7 / 4.8 补齐。
- regulation 由 Phase 6R.1 / 6R.2 承接。
- transport baseline 继续由 Phase 6.2 / 6.3 承接，但当前等官方 baseline。

## Tasks

0. 为 `transport_schedule` 选择一条 non-OCR-blocked notice 做 single-notice pilot。
1. 为 `regulation` 生成 admission manifest、dry-run、stage report 和 consistency report。
   - superseded by Phase 6R.1 / 6R.2.
2. 为 `transport_schedule` 生成 admission manifest、dry-run、stage report 和 consistency report。
3. 为 `service_status` 生成 admission manifest、dry-run、stage report 和 consistency report。
4. 输出 rejected/deferred source report。
5. 验证 downstream rows 能回链到 searchable notice row 和 source objects。

## Pilot Evidence

Single-notice pilot evidence:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/pilot-transport-schedule-355512/`

Generated files:

- `consumer-admission-manifest.json`
- `replay.dry-run.json`
- `stage-report.json`
- `consistency-report.json`
- `source-to-searchable-downstream-trace.json`
- `rejected-deferred-source-report.json`

Transport schedule batch evidence:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/batch-transport-schedule/`

Batch result:

- target candidate count: `4`
- downstream admitted: `1`
- needs multimodal: `3`
- stage candidate count: `1`
- consistency verdict: `passed`
- write enabled: `false`
- current promotion enabled: `false`

Service status batch evidence:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/batch-service-status/`

Batch result:

- target candidate count: `3`
- downstream admitted: `0`
- needs multimodal: `2`
- deferred / rejected: `3`
- stage candidate count: `0`
- consistency verdict: `blocked`
- accepted closeout posture: explicit replay completed, blockers reasoned and searchable retained
- write enabled: `false`
- current promotion enabled: `false`

## Acceptance

- downstream 只包含 admitted notice ids。
- transport schedule 不缺 OCR/结构化 evidence。
- service status current promotion 必须显式。
- regulation 不默认打开 query-serving。
