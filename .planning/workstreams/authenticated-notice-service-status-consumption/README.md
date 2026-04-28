---
doc_type: index
status: active
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

- status: `active`
- current phase: `Phase 8`
- current focus: Phase 8 broader live family coverage。Phase 7 已证明真实
  authenticated notice `355650` 可以完成
  `notice_consumption_projection -> service-status typed projection -> PG current
  read model -> supervisor lookup -> app-api/public-chat answer` 闭环；现在开始用真实
  export 样本扩展 IT platform、library、service-counter 和 additional facility
  coverage。当前 `notice_consumption_projection` 只有 `355650` 一个非 transport
  service-status candidate，因此 Phase 8 首先诊断 source/admission/materializer
  缺口，不用 fixture 冒充 live coverage。
- runtime claim: 使用 `uv run --all-packages python -m scripts.workstream_claim
  claim status authenticated-notice-service-status-consumption` 查看；tracked
  planning 文档不保存 claim lease

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
