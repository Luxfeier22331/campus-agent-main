---
doc_type: state
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# State: Collected Notice Consumption Replay Closeout

## Current Position

- status: `completed`
- current phase: `Phase 7 complete`
- current slice: collected notice consumption replay closeout completed with deferred service-status items explicitly recorded
- last activity: 2026-04-29
- last activity description: Phase 7 closeout completed. Acceptance verdict is `passed_with_deferred_items`: `338` valid captured notices are searchable, queue-backed replay projected `338` jobs with `0` failed, regulation remains no-write offline preparation, transport schedule respects baseline/OCR gates, and service-status replay is explicit with `3` blocked/deferred candidates and no current promotion.

## Why This Workstream Exists

当前已有采集对象、source-truth inventory 与部分下游试验数据，但状态混合：

- object-native handoff 已基本完成，但不等于所有采集通知已经被正确消费。
- `internal_notice_read_model` 当前为 `0`，因此全量可检索层尚未落地。
- `notice_consumption_projection`、schedule OCR、typed service-status/service-guide/transport release 已有旧数据，但混合了 smoke、stage、manual-review、current 和 partial replay。
- WeChat 与 file_release/regulation 的首期消费边界需要在重新导入前统一。

本线目标是恢复干净基线，并用 dry-run + manifest 重新导入与消费当前已采集内容。

## Completed Tasks

- [x] Created native workstream directory.
- [x] Defined target shape and scope.
- [x] Split roadmap into 7 phases.
- [x] Recorded current local PG baseline from read-only audit.
- [x] Produced Phase 1 captured run inventory.
- [x] Produced Phase 1 source-truth inventory audit.
- [x] Produced Phase 1 derived/downstream state inventory.
- [x] Produced Phase 1 reset dry-run manifest.
- [x] Produced Phase 1 reset backup plan.
- [x] Decided Phase 3 reset should clear source-truth / holding / registry import rows to return to captured-but-not-imported.
- [x] Decided mixed `service_guide` cleanup should be source-lineage based and preserve stable PDF/handbook/campus-card rows.
- [x] Froze captured -> source-truth -> searchable -> admission -> downstream chain contract.
- [x] Froze consumer admission schema and fixture covering all consumption classes.
- [x] Froze searchable notice layer schema.
- [x] Froze downstream batching policy for `regulation`, `transport_schedule`, and `service_status`.
- [x] Froze dry-run no-write report contract.
- [x] Implemented Phase 3 collected notice reset worker.
- [x] Produced Phase 3 reset dry-run report.
- [x] Produced Phase 3 backup artifact before execute.
- [x] Executed reset to captured-but-not-imported boundary.
- [x] Preserved stable `service_guide` current by promoting `service-guide-campus-card-20260427T110000`.
- [x] Produced post-reset audit with `verdict=passed`.
- [x] Built dry-run reimport plan from captured objects and verified run refs.
- [x] Produced source-truth / document holding preview.
- [x] Produced searchable notice preview.
- [x] Produced searchable coverage report with `verdict=passed`.
- [x] Produced invalid / defer / requires-multimodal report.
- [x] Confirmed dry-run writes no DB or object-store state.
- [x] Planned Phase 4.5 notice ingest queue contract.
- [x] Implemented Phase 4.5 notice ingest queue contract.
- [x] Planned Phase 4.6 PG-backed queue store and lease runtime.
- [x] Planned Phase 4.7 historical captured inventory synthetic enqueue.
- [x] Planned Phase 4.8 queue consumer reimport path.
- [x] Planned Phase 6R.1 regulation candidate audit and admission.
- [x] Planned Phase 6R.2 regulation promotion dry-run and gated materialization.
- [x] Implemented Phase 4.6 PG-backed queue store and lease runtime.
- [x] Implemented Phase 4.7 historical captured inventory synthetic enqueue dry-run.
- [x] Implemented Phase 4.8 queue consumer reimport path.
- [x] Regenerated full Phase 4.8 queue-backed searchable evidence for all 338 historical jobs.
- [x] Implemented Phase 6R.1 regulation candidate audit and admission preview.
- [x] Produced Phase 6R.1 regulation admission, audit, rejected/deferred, and source trace evidence.
- [x] Planned and implemented Phase 6R.1a regulation owner-text recovery mini-batch.
- [x] Produced Phase 6R.1a owner-text recovery batch, attempt plan, searchable merge contract, and gap report evidence.
- [x] Planned and implemented Phase 6R.1b regulation owner-text recovery execution.
- [x] Executed Phase 6R.1b selected mini-batch: `10/10` owner-text attempts succeeded with `mineru_api`, object-store refs written, DB writes disabled.
- [x] Reran Phase 6R.1 regulation admission/audit against Phase 6R.1b owner-text-ready refs.
- [x] Planned and implemented Phase 6R.2 regulation promotion dry-run and gated materialization preview.
- [x] Produced Phase 6R.2 institutional/scoped materialization preview, duplicate aggregation, consistency, and source-to-target trace evidence.
- [x] Planned Phase 6R.3 regulation normalization quality gate before Phase 7 closeout.
- [x] Implemented Phase 6R.3 regulation text normalization boundary and quality report.
- [x] Reran regulation materialization preview with normalized canonical text.
- [x] Produced Phase 6R.3 before/after evidence and consistency report.
- [x] Implemented Phase 6R.4 collected notice classification precision repair.
- [x] Reran Phase 4 searchable preview with taxonomy-backed `classification`.
- [x] Reran Phase 5 multimodal readiness with classification-backed priority.
- [x] Reran Phase 6R.1 regulation admission/audit against repaired classification.
- [x] Produced Phase 6R.4 classification precision audit report with `verdict=passed`.
- [x] Implemented Phase 6R.5 target classification hardening.
- [x] Reran Phase 4 searchable preview with target-specific resolver output.
- [x] Reran Phase 5 multimodal readiness with hardened target candidates.
- [x] Reran Phase 6R.1 regulation admission/audit against hardened classification.
- [x] Produced Phase 6R.5 target hardening audit report with `verdict=passed`.
- [x] Implemented Phase 6.2 official transport baseline canonical preview.
- [x] Ran MinerU no-write OCR against the user-provided baseline image.
- [x] Parsed `32` official baseline canonical rows with `effective_from=2026-03-20`.
- [x] Reclassified transport notice batch against the imported baseline.
- [x] Implemented Phase 6.3 schedule image OCR mini-batch manifest and post-run preview.
- [x] Ran provider OCR dry-run for `4` baseline-aware schedule images.
- [x] Produced `32` dry-run transport stage candidates from `355867`.
- [x] Kept low-confidence OCR outputs for `355867` image 3 and `355881` image 1 out of downstream stage.
- [x] Built `service_status` downstream replay admission manifest.
- [x] Dry-run replayed `service_status` target batch.
- [x] Produced `service_status` stage, consistency, trace, and rejected/deferred reports.
- [x] Generated Phase 7 acceptance summary and source-to-queue-to-search-to-downstream trace.
- [x] Completed workstream closeout with verdict `passed_with_deferred_items`.

## Current Phase Tasks

- [x] Build multimodal candidate inventory from Phase 4 `needs_multimodal_units`.
- [x] Define unified notice multimodal consumption ledger / attempt / normalized output contract.
- [x] Map existing schedule image OCR, internal notice multimodal, and WeChat multimodal states into one lifecycle.
- [x] Produce OCR batch dry-run manifest.
- [x] Produce searchable merge preview for normalized multimodal text.
- [x] Output multimodal gap report.
- [x] Select a non-OCR-blocked single notice for Phase 6 downstream pilot.
- [x] Produce single-notice `transport_schedule` no-write admission, dry-run replay, stage, consistency, trace, and rejected/deferred reports.
- [x] Build `transport_schedule` target batch admission manifest.
- [x] Dry-run replay admitted `transport_schedule` target batch.
- [x] Produce `transport_schedule` stage and consistency reports.
- [x] Insert Phase 6.1 / 6.2 / 6.3 planning before Phase 7.
- [x] Implement Phase 6.1 baseline-aware transport admission policy.
- [x] Implement Phase 4.6 PG-backed queue store and lease runtime.
- [x] Implement Phase 4.7 historical captured inventory synthetic enqueue.
- [x] Implement Phase 4.8 queue consumer reimport path.
- [x] Build queue-backed searchable evidence for regulation replay.
- [x] Build Phase 6R.1 regulation candidate audit and admission evidence.
- [x] Build Phase 6R.1a regulation owner-text recovery mini-batch evidence.
- [x] Execute Phase 6R.1b regulation owner-text recovery mini-batch.
- [x] Rerun Phase 6R.1 regulation admission/audit against owner-text-ready refs.
- [x] Build Phase 6R.2 regulation promotion dry-run and gated materialization evidence for the `8` refreshed downstream-admitted candidates.
- [x] Implement Phase 6R.3 regulation text normalization boundary and quality report.
- [x] Rerun regulation materialization preview with normalized canonical text.
- [x] Produce Phase 6R.3 before/after evidence and consistency report.
- [x] Fix collected notice classifier so weak keyword hints do not drive typed admission.
- [x] Verify ordinary notice false-positive probes are absent from regulation admission.
- [x] Fix `transport_schedule` target projection so only shuttle/commute schedule notices remain.
- [x] Fix `service_status` target projection so procurement and construction/bid/result notices are excluded.
- [x] Expand file-release regulation taxonomy coverage for stable owner documents.
- [x] Wait for official `2026-03-01` baseline file before Phase 6.2.
- [x] Run official baseline no-write OCR and canonical preview.
- [x] Reclassify transport batch against baseline source coverage.
- [x] Run schedule image OCR mini batch only for baseline-aware eligible overlays.
- [x] Build `service_status` downstream replay admission manifest.
- [x] Dry-run replay `service_status` target batch.
- [x] Produce `service_status` stage and consistency report.
- [x] Generate Phase 7 acceptance and closeout evidence.

## Known Non-Overlap

- 定时调度与认证续期不属于本线。
- collector acquisition provider 不属于本线。
- object-native collector-worker handoff closeout 不属于本线，除非 reset/replay 发现 handoff evidence drift。
- existing `notice-consumption-layer` schema 不在本线随意重写；本线只在首期 replay contract 中消费它。

## Blockers

- No closeout blockers remain for this workstream.
- Deferred service-status items are tracked, not hidden blockers: `355549` and `355650` need multimodal owner text before target readiness; `355283` needs extractor/policy review because no service-status window/signal was materialized from the available text.
- Remaining regulation `needs_multimodal` / manual-review rows are outside this closeout's required no-write acceptance and should be reopened only through a new explicit admission slice.

## Verification Plan

Planning-only start:

```bash
pnpm docs:lint
```

Final closeout verification uses focused ingestion tests, ruff, docs lint, JSON validation, and diff whitespace checks.

## Resume Notes

Start with:

- `README.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `phases/phase-03-reset-derived-state-to-collected-only/SUMMARY.md`
- `phases/phase-04-dry-run-reimport-and-universal-search-preview/SUMMARY.md`
- `phases/phase-04-5-notice-ingest-queue-contract/PLAN.md`
- `phases/phase-04-5-notice-ingest-queue-contract/SUMMARY.md`
- `phases/phase-04-5-notice-ingest-queue-contract/NOTICE-INGEST-QUEUE-CONTRACT.md`
- `phases/phase-04-6-pg-backed-queue-store-and-lease-runtime/PLAN.md`
- `phases/phase-04-6-pg-backed-queue-store-and-lease-runtime/SUMMARY.md`
- `phases/phase-04-7-historical-captured-inventory-synthetic-enqueue/PLAN.md`
- `phases/phase-04-7-historical-captured-inventory-synthetic-enqueue/SUMMARY.md`
- `phases/phase-04-8-queue-consumer-reimport-path/PLAN.md`
- `phases/phase-04-8-queue-consumer-reimport-path/SUMMARY.md`
- `phases/phase-05-multimodal-ocr-consumption-readiness/SUMMARY.md`
- `phases/phase-06-batched-downstream-replay/PILOT-SUMMARY.md`
- `phases/phase-06-batched-downstream-replay/TRANSPORT-BATCH-SUMMARY.md`
- `phases/phase-06-1-transport-baseline-aware-admission-policy/PLAN.md`
- `phases/phase-06-1-transport-baseline-aware-admission-policy/SUMMARY.md`
- `phases/phase-06-1-transport-baseline-aware-admission-policy/TRANSPORT-BASELINE-AWARE-ADMISSION-POLICY.md`
- `phases/phase-06-r1-regulation-candidate-audit-and-admission/PLAN.md`
- `phases/phase-06-r1-regulation-candidate-audit-and-admission/SUMMARY.md`
- `phases/phase-06-r1a-regulation-owner-text-recovery-mini-batch/PLAN.md`
- `phases/phase-06-r1a-regulation-owner-text-recovery-mini-batch/SUMMARY.md`
- `phases/phase-06-r1b-regulation-owner-text-recovery-execution/PLAN.md`
- `phases/phase-06-r1b-regulation-owner-text-recovery-execution/SUMMARY.md`
- `phases/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/PLAN.md`
- `phases/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/SUMMARY.md`
- `phases/phase-06-r3-regulation-normalization-quality-gate/PLAN.md`
- `phases/phase-06-r3-regulation-normalization-quality-gate/SUMMARY.md`
- `phases/phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/PLAN.md`
- `phases/phase-06-3-schedule-image-ocr-mini-batch/PLAN.md`
- `phases/phase-06-3-schedule-image-ocr-mini-batch/SUMMARY.md`
- `evidence/phase-03-reset-derived-state-to-collected-only/post-reset-collected-only-audit.json`
- `evidence/phase-04-dry-run-reimport-and-universal-search-preview/reimport-plan.dry-run.json`
- `evidence/phase-04-dry-run-reimport-and-universal-search-preview/searchable-coverage-report.json`
- `evidence/phase-04-8-queue-consumer-reimport-path/queue-consume.dry-run.json`
- `evidence/phase-04-8-queue-consumer-reimport-path/searchable-coverage-after-queue-consume.json`
- `evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-consumer-admission-manifest.json`
- `evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-candidate-audit.json`
- `evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-rejected-deferred-source-report.json`
- `evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-source-to-searchable-trace.json`
- `evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch/regulation-owner-text-recovery-batch-manifest.json`
- `evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch/regulation-owner-text-attempt-plan.json`
- `evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch/regulation-owner-text-searchable-merge-contract.json`
- `evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch/regulation-owner-text-readiness-gap-report.json`
- `evidence/phase-06-r1b-regulation-owner-text-recovery-execution/dry-run/regulation-owner-text-execution-report.json`
- `evidence/phase-06-r1b-regulation-owner-text-recovery-execution/regulation-owner-text-execution-report.json`
- `evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/institutional-rules-materialization.dry-run.json`
- `evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/scoped-rules-materialization.dry-run.json`
- `evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/duplicate-provenance-aggregation-report.json`
- `evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/regulation-materialization-consistency-report.json`
- `evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/regulation-source-to-target-trace.json`
- `evidence/phase-06-r3-regulation-normalization-quality-gate/institutional-rules-materialization.normalized.dry-run.json`
- `evidence/phase-06-r3-regulation-normalization-quality-gate/scoped-rules-materialization.normalized.dry-run.json`
- `evidence/phase-06-r3-regulation-normalization-quality-gate/regulation-normalization-quality-report.json`
- `evidence/phase-06-r3-regulation-normalization-quality-gate/regulation-normalization-before-after-report.json`
- `evidence/phase-06-r3-regulation-normalization-quality-gate/regulation-normalization-consistency-report.json`
- `evidence/phase-05-multimodal-ocr-consumption-readiness/ocr-batch-manifest.dry-run.json`
- `evidence/phase-05-multimodal-ocr-consumption-readiness/multimodal-gap-report.json`
- `evidence/phase-06-batched-downstream-replay/pilot-transport-schedule-355512/consistency-report.json`
- `evidence/phase-06-batched-downstream-replay/batch-transport-schedule/consistency-report.json`
- `evidence/phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/official-baseline-consistency-report.json`
- `evidence/phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/transport-batch-reclassified/consumer-admission-manifest.json`
- `evidence/phase-06-3-schedule-image-ocr-mini-batch/schedule-image-ocr-execution-manifest.json`
- `evidence/phase-06-3-schedule-image-ocr-mini-batch/post-run-preview/transport-ocr-consistency-report.json`
- `evidence/phase-06-3-schedule-image-ocr-mini-batch/post-run-preview/schedule-image-ocr-post-run-gap-report.json`

This workstream is closed out. Reopen only if collected-notice replay evidence drifts, a new downstream target is explicitly admitted, service-status deferred candidates receive normalized multimodal evidence and are ready for a new target replay, or Phase 7 acceptance evidence becomes stale against the current chain contract.
