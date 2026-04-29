---
doc_type: summary
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Transport Schedule Batch Summary

## Result

Phase 6 now has a no-write `transport_schedule` target batch preview with
Phase 6.1 baseline-aware admission fields. It does not write database state,
write object storage, run OCR, or promote current runtime state.

This is still not the full Phase 6 closeout because `regulation` and
`service_status` target batches have not started. Regulation replay is now split
into Phase 6R.1 and Phase 6R.2, after queue-backed ingest phases produce
searchable evidence.

## Evidence

Evidence directory:

`.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-batched-downstream-replay/batch-transport-schedule/`

Generated files:

- `consumer-admission-manifest.json`
- `replay.dry-run.json`
- `stage-report.json`
- `consistency-report.json`
- `source-to-searchable-downstream-trace.json`
- `rejected-deferred-source-report.json`

## Counts

- transport candidate entries: `4`
- downstream admitted: `1`
- needs multimodal: `3`
- defer: `0`
- extracted schedule rows: `1`
- stage candidate count: `1`
- consistency verdict: `passed`
- rejected/deferred entries: `3`
- transport baseline status: `missing`
- OCR execute now: `0`
- OCR defer until baseline: `3`

## Admission Outcomes

- `355512` / `关于本周六临时增加学生班车班次的通知`
  - outcome: `downstream_admitted`
  - row: `route:fengtai-to-haidian`, `06:40`, `2026-04-11`
- `355122` / `关于两校区学生通勤班车增加班次的通知`
  - outcome: `needs_multimodal`
  - reason: `multimodal_not_ready`
  - baseline gate: `awaiting_baseline`, `defer_until_baseline`
- `355867` / `关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`
  - outcome: `needs_multimodal`
  - reason: `multimodal_not_ready`
  - baseline gate: `awaiting_baseline`, `defer_until_baseline`
- `355881` / `关于开通丰台校区社会实践专车的通知`
  - outcome: `needs_multimodal`
  - reason: `multimodal_not_ready`
  - baseline gate: `awaiting_baseline`, `defer_until_baseline`

## Boundaries

- No database writes.
- No object-store writes.
- No current promotion.
- Baseline missing means schedule-image OCR is deferred until Phase 6.2 imports the official baseline.
- OCR/multimodal-pending schedule notices are blocked, not staged.
- Non-transport notices are outside this target batch and are not silently admitted.

## Follow-Up Split

- Phase 4.5 / 4.6 / 4.7 / 4.8: build the queue-backed ingest path that
  historical inventory and future live discovery both use.
- Phase 6R.1: regulation candidate audit and admission.
- Phase 6R.2: regulation promotion dry-run and gated materialization.
- Phase 6.2 / 6.3: transport baseline and schedule image OCR remain paused until
  the official `2026-03-01` baseline is available.
