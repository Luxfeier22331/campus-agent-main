---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6.1 Plan: Transport Baseline-Aware Admission Policy

## Goal

在官方 baseline 文件到位前，先冻结 transport schedule downstream admission
的 baseline-aware 门控。核心目标是防止两类错误：

- 把历史 notice 图片资产全量 OCR，当作 current schedule 消费。
- 因 OCR-ready 或正文可解析，就把过期/未知语义 notice 直接 stage。

## Inputs

- Phase 4 `searchable-notice-preview.json`
- Phase 5 `multimodal-candidate-inventory.json`
- Phase 5 `ocr-attempt-plan.json`
- Phase 6 `batch-transport-schedule` evidence
- 暂缺：官方 `2026-03-01` baseline 文件

## Policy Fields

给 transport admission entry 增加以下字段：

- `baseline_status`
  - `missing`
  - `available`
- `baseline_effective_date`
  - baseline 缺失时为空
  - baseline 到位后固定为官方 source effective date
- `temporal_relation`
  - `pre_baseline`
  - `post_baseline`
  - `active_or_future_window`
  - `expired_temporary_window`
  - `unknown`
- `overlay_kind`
  - `awaiting_baseline`
  - `baseline_delta_candidate`
  - `temporary_overlay`
  - `temporary_exception`
  - `historical_search_only`
  - `manual_review`
- `ocr_priority`
  - `execute_now`
  - `defer_until_baseline`
  - `search_only`
  - `manual_review`
- `current_eligible`
  - default `false`
- `baseline_gate_reason_codes`
  - e.g. `transport_baseline_missing`, `schedule_image_requires_ocr`,
    `post_baseline_delta_candidate`, `temporary_window_detected`,
    `manual_review_required`

## Tasks

1. [x] Add baseline-aware classification helper for transport schedule admission.
2. [x] Extend no-write transport batch manifest with the policy fields above.
3. [x] Keep existing `needs_multimodal` classification but add baseline-specific reasons.
4. [x] Refresh `batch-transport-schedule` evidence.
5. [x] Add tests for:
   - baseline missing + image pending => `defer_until_baseline`
   - text-only admitted pilot remains no-write and not current-eligible
   - post-baseline delta phrase => `baseline_delta_candidate`
   - explicit date window => `temporary_overlay`
   - pre-baseline historical notice => `historical_search_only`

## Acceptance

- [x] No database writes.
- [x] No object-store writes.
- [x] No current promotion.
- [x] Transport schedule batch manifest shows why each pending image is waiting.
- [x] OCR is not triggered in this phase.
- [x] `transport_schedule` downstream stage still contains only admitted rows with
  complete structured evidence.

## Verification

```bash
uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_downstream_pilot tests.ingestion.test_preview_collected_notice_downstream_pilot_worker
uv run --all-packages python -m unittest tests.ingestion.test_internal_notice_schedule_body tests.ingestion.test_notice_derived_transport_schedule_materialization tests.ingestion.test_build_transport_schedule_projection_worker
uv run --all-packages ruff check packages/ingestion-core/src/campus_ingestion_core/collected_notice_downstream_pilot.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_downstream_pilot.py tests/ingestion/test_collected_notice_downstream_pilot.py tests/ingestion/test_preview_collected_notice_downstream_pilot_worker.py
uv run --all-packages ruff format --check packages/ingestion-core/src/campus_ingestion_core/collected_notice_downstream_pilot.py apps/ingestion-worker/src/campus_ingestion_worker/preview_collected_notice_downstream_pilot.py tests/ingestion/test_collected_notice_downstream_pilot.py tests/ingestion/test_preview_collected_notice_downstream_pilot_worker.py
find .planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/batch-transport-schedule -name '*.json' -print0 | xargs -0 -n1 jq empty
pnpm docs:lint
git diff --check
```
