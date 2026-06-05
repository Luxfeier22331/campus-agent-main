---
doc_type: index
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Workstream: Authenticated Notice Service Status Consumption

<!-- markdownlint-disable MD013 -->

这是 `authenticated-notice-service-status-consumption` 的 native workstream 入口。

这条线只负责把已进入 `notice_consumption_projection` 的
`campus_services/service_status_candidate` 通知，进一步消费成
`campus_services/service_status` 的 typed projection、PostgreSQL read model 与
`service_status_lookup` 可查询 truth。

它不重开泛 `notice-consumption-layer`，不接管 regulation/schedule 两条并行线，也不把 service
status 问题回退成 generic RAG 或 notice body query-time scan。

## Current Status

- status: `completed`
- current phase: `Phase 9 completed`
- current focus: Phase 9 current release composition 已完成。PG current release
  为 `service-status-current-20260428T122000`，当前有效 records 包含
  `355650` 静园 10 号楼女浴室与 `354845` 丰台校区校医院皮肤科门诊；Phase 8
  historical samples `247726`、`352345`、`354502`、`354575`、`354674`
  保留为 rejected-source evidence，不进入 current truth。本 workstream 已归档到
  `.planning/milestones/ws-authenticated-notice-service-status-consumption-2026-04-28/`。
- workstream status: 使用 `gsd-sdk query workstream.status
  authenticated-notice-service-status-consumption --raw --cwd "$PWD"` 查看；
  tracked planning 文档不保存本地会话状态

## Source Truth And Adjacent Workstreams

- source channel / candidate truth:
  `docs/architecture/domains/authenticated-notice/architecture.md`
- campus-services runtime boundary:
  `docs/architecture/domains/campus-services/architecture.md`
- release/read-model decision:
  `docs/decisions/adr-0044-structured-projection-release-catalog-and-read-model.md`
- completed foundation:
  `.planning/workstreams/notice-consumption-layer/README.md`
- parallel regulation line:
  `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
- parallel notice routing / Web card line:
  `.planning/workstreams/notice-routing-taxonomy-and-web-card-consumption/README.md`
- schedule reference implementation:
  `apps/ingestion-worker/src/campus_ingestion_worker/build_transport_schedule_projection.py`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- boundary: `./BOUNDARY.md`
- selected cohort: `./SELECTED-COHORT.md`

## Phase Plans

- `./phases/phase-01-boundary-and-selected-admission/PLAN.md`
- `./phases/phase-02-projection-contract-and-schema/PLAN.md`
- `./phases/phase-03-materializer-coverage/PLAN.md`
- `./phases/phase-04-release-read-model-and-promotion/PLAN.md`
- `./phases/phase-05-runtime-query-and-eval/PLAN.md`
- `./phases/phase-06-product-source-presentation/PLAN.md`
- `./phases/phase-07-live-admission-and-downstream-consumption-loop/PLAN.md`
- `./phases/phase-08-broader-live-family-coverage/PLAN.md`
- `./phases/phase-08-broader-live-family-coverage/SUMMARY.md`
- `./phases/phase-09-current-release-composition-and-safe-promotion/PLAN.md`
- `./phases/phase-09-current-release-composition-and-safe-promotion/SUMMARY.md`
