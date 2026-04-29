---
doc_type: policy
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Transport Baseline-Aware Admission Policy

## Decision

`transport_schedule` notice consumption is now baseline-aware before OCR execution or current promotion.

The official transport baseline is expected to be the `2026-03-01` schedule file, but that file is not present yet. Until Phase 6.2 imports it, schedule-image notices must not be blindly OCR'd or promoted. They remain searchable candidates and carry explicit admission reasons.

## Admission Fields

Each transport admission entry carries:

- `baseline_status`: `missing` or `available`.
- `baseline_effective_date`: empty when missing, otherwise the official baseline date.
- `temporal_relation`: `pre_baseline`, `post_baseline`, `active_or_future_window`, `expired_temporary_window`, or `unknown`.
- `overlay_kind`: `awaiting_baseline`, `baseline_delta_candidate`, `temporary_overlay`, `temporary_exception`, `historical_search_only`, or `manual_review`.
- `ocr_priority`: `execute_now`, `defer_until_baseline`, `search_only`, or `manual_review`.
- `current_eligible`: always `false` in Phase 6.1.
- `baseline_gate_reason_codes`: stable reason codes for operator review and replay gating.

## Gate Rules

- Baseline missing + schedule image pending/failed => `overlay_kind=awaiting_baseline`, `ocr_priority=defer_until_baseline`.
- Text-only structured extraction may still produce dry-run stage candidates, but `current_eligible=false` and no current promotion is allowed.
- With a baseline date available, post-baseline durable change language such as `起`, `增加`, `增开`, `调整`, or `恢复` becomes `baseline_delta_candidate`.
- Explicit service windows such as `4月27日-5月5日` become `temporary_overlay` or `temporary_exception`.
- Pre-baseline notices are `historical_search_only` even if they contain parseable date noise.

## Current Evidence

Refreshed no-write batch evidence:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/batch-transport-schedule/`

Current transport batch result with baseline missing:

- candidate entries: `4`
- downstream admitted: `1`
- needs multimodal: `3`
- OCR execute now: `0`
- OCR defer until baseline: `3`
- stage candidate count: `1`
- consistency verdict: `passed`
- write enabled: `false`
- current promotion enabled: `false`

Blocked schedule-image notices:

- `355122` / `关于两校区学生通勤班车增加班次的通知`
  - `overlay_kind=awaiting_baseline`
  - `ocr_priority=defer_until_baseline`
  - reasons: `transport_baseline_missing`, `schedule_image_requires_ocr`
- `355867` / `关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`
  - `overlay_kind=awaiting_baseline`
  - `ocr_priority=defer_until_baseline`
  - reasons: `transport_baseline_missing`, `schedule_image_requires_ocr`
- `355881` / `关于开通丰台校区社会实践专车的通知`
  - `overlay_kind=awaiting_baseline`
  - `ocr_priority=defer_until_baseline`
  - reasons: `transport_baseline_missing`, `schedule_image_requires_ocr`

## Boundaries

- No database writes.
- No object-store writes.
- No OCR provider calls.
- No current promotion.
- Phase 6.2 must import the official baseline before schedule-image OCR eligibility is reopened.
