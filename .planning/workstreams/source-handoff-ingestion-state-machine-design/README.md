---
doc_type: index
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Source Handoff Ingestion State Machine Design

本 workstream 负责把两个 collector 到同一个 ingestion-worker 的跨 runtime 状态机设计收口。

覆盖范围：

- `apps/official-web-collector`
- `apps/authenticated-notice-collector`
- `apps/ingestion-worker`
- `packages/ingestion-core`
- `apps/app-api` 中已经承担 `official_web` control-plane 的 run / artifact / handoff projection

## Current Status

- status: `completed`
- current phase: `Phase 10 closeout complete`
- active implementation: shared contract/store plus official-web and authenticated-notice adapter
  foundations plus worker/operator projection implemented
- current slice: 本 workstream 已完成并关闭。后续生产化 adoption 走 dormant seed
  `.planning/seeds/SEED-003-source-handoff-runtime-store-adoption.md`，不要把部署 wiring 继续塞回
  本设计线。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- state machine design: `./STATE-MACHINE-DESIGN.md`
- contract/store plan: `./CONTRACT-STORE-PLAN.md`
- official-web adapter plan: `./OFFICIAL-WEB-ADAPTER-PLAN.md`
- authenticated-notice adapter plan: `./AUTHENTICATED-NOTICE-ADAPTER-PLAN.md`
- worker execution / operator projection plan:
  `./WORKER-EXECUTION-OPERATOR-PROJECTION-PLAN.md`
- implementation readiness review: `./IMPLEMENTATION-READINESS-REVIEW.md`
- closeout: `./CLOSEOUT.md`

## Phase Plans

- Phase 1: `./phases/phase-01-contract-package-and-store-plan/PLAN.md`
- Phase 2: `./phases/phase-02-official-web-adapter-implementation-plan/PLAN.md`
- Phase 3: `./phases/phase-03-authenticated-notice-adapter-implementation-plan/PLAN.md`
- Phase 4: `./phases/phase-04-worker-execution-and-operator-projection-plan/PLAN.md`
- Phase 5: `./phases/phase-05-implementation-readiness-review/PLAN.md`
- Phase 6: `./phases/phase-06-shared-contract-and-store-implementation/PLAN.md`
- Phase 7: `./phases/phase-07-official-web-adapter-implementation/PLAN.md`
- Phase 8: `./phases/phase-08-authenticated-notice-adapter-implementation/PLAN.md`
- Phase 9: `./phases/phase-09-worker-execution-and-operator-projection-implementation/PLAN.md`
- Phase 10: `./phases/phase-10-closeout-gate-and-migration-readiness/PLAN.md`

Phase summaries:

- Phase 1: `./phases/phase-01-contract-package-and-store-plan/SUMMARY.md`
- Phase 2: `./phases/phase-02-official-web-adapter-implementation-plan/SUMMARY.md`
- Phase 3: `./phases/phase-03-authenticated-notice-adapter-implementation-plan/SUMMARY.md`
- Phase 4: `./phases/phase-04-worker-execution-and-operator-projection-plan/SUMMARY.md`
- Phase 5: `./phases/phase-05-implementation-readiness-review/SUMMARY.md`
- Phase 6: `./phases/phase-06-shared-contract-and-store-implementation/SUMMARY.md`
- Phase 7: `./phases/phase-07-official-web-adapter-implementation/SUMMARY.md`
- Phase 8: `./phases/phase-08-authenticated-notice-adapter-implementation/SUMMARY.md`
- Phase 9: `./phases/phase-09-worker-execution-and-operator-projection-implementation/SUMMARY.md`
- Phase 10: `./phases/phase-10-closeout-gate-and-migration-readiness/SUMMARY.md`

## Boundary Notes

- 本线不把 `official-web-collector` 和 `authenticated-notice-collector` 合并成同一个采集器。
- 本线不改变 source-channel run ownership：
  - `official_web` 的 crawl-run control plane 继续归 `apps/app-api`
  - `authenticated_notice_portal` 的第一阶段 run ledger 继续归 collector / ingestion source
    channel 侧
- 本线只统一跨 runtime 边界：source handoff、object verification、ingestion execution、
  step / child-task evidence、retry / lease / terminal semantics。
- 本线不让 collector 直接写 document registry、projection read model、chunk、index 或 query-serving
  surface。
- 本线不把 worker 本地 JSON、local export path、telemetry sink 或 panel projection 当作 canonical
  system truth。
- 本线不打开 `official_web/fresh_news`、internal notice、service status 或任何新 query-serving
  surface。

## Related Architecture

- `docs/architecture/domains/official-web/architecture.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/data/app-api-official-web-schema.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/file-asset-loader-architecture.md`
- `.planning/workstreams/official-web-collection-restart-closeout/README.md`
- `.planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/README.md`
- `.planning/workstreams/runtime-otel-observability-bridge/README.md`
