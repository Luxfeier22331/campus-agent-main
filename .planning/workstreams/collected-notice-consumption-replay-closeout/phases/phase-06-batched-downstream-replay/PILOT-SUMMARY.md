---
doc_type: summary
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Pilot Summary: Transport Schedule Notice 355512

## Result

Phase 6 now has a single-notice no-write pilot for one `transport_schedule` notice.
This is not a full target batch replay and does not admit `regulation` or `service_status`.

Pilot notice:

- `source_notice_id`: `355512`
- title: `关于本周六临时增加学生班车班次的通知`
- target: `transport_schedule`
- multimodal status: `not_required`

## Evidence

Evidence directory:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/pilot-transport-schedule-355512/`

Generated files:

- `consumer-admission-manifest.json`
- `replay.dry-run.json`
- `stage-report.json`
- `consistency-report.json`
- `source-to-searchable-downstream-trace.json`
- `rejected-deferred-source-report.json`

## Counts

- `entry_count`: `1`
- `downstream_admitted`: `1`
- `extracted_schedule_row_count`: `1`
- `stage_candidate_count`: `1`
- `source_object_ref_count`: `11`
- `current_promotion_enabled`: `false`
- `consistency_verdict`: `passed`
- rejected/deferred entries: `0`

Extracted row:

- route: `route:fengtai-to-haidian`
- direction: `fengtai_to_haidian`
- departure time: `06:40`
- weekday scope: `weekends`
- rider type: `学生`
- service date range: `2026-04-11` to `2026-04-11`
- scope: `temporary_period`

## Boundaries

- No database writes.
- No object-store writes.
- No current promotion.
- No batch expansion.
- The pilot depends on Phase 4 searchable preview and Phase 5 multimodal readiness evidence.

## Next Decision

After reviewing this pilot evidence, Phase 6 can either add another single-notice pilot or expand to the first target batch. Batch expansion must keep the same no-write admission, stage, consistency, and trace reports.
