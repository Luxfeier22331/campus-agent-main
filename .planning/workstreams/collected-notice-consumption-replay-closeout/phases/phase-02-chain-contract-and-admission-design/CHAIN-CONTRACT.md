---
doc_type: contract
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Chain Contract

## Goal

本 contract 冻结首期“已采集通知重新消费”链路：

`captured source objects + collector run ledger -> reset to captured-only -> dry-run import -> source-truth / holding -> universal searchable notice layer -> consumer admission -> regulation / transport_schedule / service_status replay`

本链路不负责定时调度、认证续期、新采集范围或新 serving surface。

## State Model

### `captured`

source bucket 中存在原始采集对象，collector run ledger 中存在对应 run / object refs。

稳定事实：

- source bucket object refs。
- collector run ledger。
- object locator evidence。
- collector run evidence。

不代表：

- 已导入 source-truth。
- 已进入 searchable layer。
- 已进入 downstream consumer。

### `imported_source_truth`

ingestion worker 根据 captured object refs 生成 source-truth / document holding / registry import rows。

首期 reset 后该状态必须被清掉，直到 Phase 4 dry-run / replay 重新生成。

### `searchable`

所有 valid captured notices 都应有一个 searchable notice unit。

searchable unit 只表达可检索和回链，不表达 downstream target 已消费。

### `needs_multimodal`

通知正文或关键事实位于图片、PDF、Office 附件或其他 media asset 中。

该状态必须进入统一 notice multimodal consumption ledger，后续 Phase 5 处理。

### `downstream_admitted`

通知被 explicit consumer admission manifest 接纳到首期 target：

- `regulation`
- `transport_schedule`
- `service_status`

未 admission 的 source 不得进入 typed downstream。

### `defer`

通知保留 captured/source/searchable truth，但当前没有已设计好的 downstream。

### `invalid_capture`

采集对象或 provenance 不满足导入条件。

invalid capture 不进入 searchable 或 downstream；必须保留 rejection reason。

## Reset Boundary

Phase 3 reset 选择恢复到 `captured-but-not-imported`。

必须保留：

- source bucket 原始采集对象。
- collector run ledger。
- object locator evidence。
- workstream evidence。

必须清除：

- authenticated notice source-truth inventory。
- authenticated notice file-release inventory。
- authenticated notice / file_release 导入产生的 document holding rows。
- authenticated notice / file_release 导入产生的 raw asset registry rows。
- authenticated notice / file_release 导入产生的 document registry rows。
- notice consumption projection。
- internal notice read model。
- consumer admission batch/event rows。
- OCR / multimodal attempt rows。
- notice-derived typed downstream release/current/read-model rows。

## Import And Replay Rules

- Every import/replay command must support dry-run before write.
- Dry-run must not write DB, object store, read model, projection, release, current pointer, or OCR attempt.
- Every write mode must consume an explicit manifest produced from dry-run evidence.
- Every downstream replay must reference a completed consumer admission batch.
- Every searchable/downstream row must include source notice identity, source URL or fallback URL, source object refs, run provenance, and admission provenance.

## Service Guide Exception

`service_guide` is not a Phase 6 downstream target.

Phase 3 reset must not delete stable non-notice service-guide rows:

- handbook / `student_rules` stable PDF rows.
- campus-card stable rows.
- other non-notice-derived stable rows.

Only notice-derived rows and smoke/stage/e2e/preview rows are reset. If the current release is mixed and no stable-only release exists, Phase 3 must mark the current pointer as manual-review required rather than inventing a clean current.

## Acceptance Invariants

- Captured source truth remains available after reset.
- Source-truth / holding is absent after reset and before replay.
- Every valid captured notice has exactly one consumer admission entry.
- Every valid captured notice has a searchable destination.
- Only `downstream_admitted` entries can enter typed downstream.
- `needs_multimodal` entries cannot be treated as target-ready until Phase 5 supplies normalized evidence.
- `defer` entries stay searchable but do not enter typed downstream.
- `invalid_capture` entries stay out of searchable/downstream and carry rejection reason codes.

