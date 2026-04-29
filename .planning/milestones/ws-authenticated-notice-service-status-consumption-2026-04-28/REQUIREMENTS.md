---
doc_type: requirements
status: active
created: 2026-04-28
updated: 2026-04-28
---
# Requirements: Authenticated Notice Service Status Consumption

<!-- markdownlint-disable MD013 -->

## Goal

把 authenticated internal notice 中的 service-status 类通知，从候选分流推进到可查询的
`campus_services/service_status` structured truth：

1. 使用已存在的 `notice_consumption_projection` 和 consumer admission manifest 作为入口。
1. 只消费显式 admitted 的 `campus_services/service_status_candidate`。
1. 生成 `campus_services_projection_bundle.v1` 中的 `service_status_records`。
1. 通过 ADR-0044 的 PostgreSQL release catalog + current pointer +
   `service_status_read_model` 发布。
1. 让 `service_status_lookup` 回答当前有效服务状态，并保持 fail-close。

## In Scope

- service status 与 regulation / transport schedule / service guide / contact
  directory / notice-level query 的边界冻结
- selected admission cohort 设计与分层样本：
  - facility / classroom / self-study room / venue
  - IT platform / portal / OA / identity / campus network / card platform
  - library opening / closure / area availability
  - service counter / comprehensive service hall / campus hospital / logistics
    window
  - transport-adjacent status only when it is not a timetable / route /
    departure fact
- `service_status_records` schema extension
- notice-derived service status materializer coverage
- rejected-source report and fail-close reason taxonomy
- `build_service_status_projection` 对齐 schedule 的 `preview / stage / promote`
  publish modes
- PostgreSQL typed read model and release current-pointer verification
- `service_status_lookup` runtime matching / ambiguity / conflict regression
- public-chat answer source presentation for service status results
- deterministic eval / unit / worker / runtime tests

## Non-goals

- 不重新采集 authenticated portal
- 不处理 regulation 正文、制度材料、scoped rules 或 document-site publication
- 不接管 `transport_schedule_lookup` 的路线、班次、服务日、站点和时刻表 truth
- 不把预约入口、办理材料、办理流程投到 service status；这些属于 `service_guide_lookup` 或后续 process line
- 不把 stable contact 改动投到 service status；联系方式属于 contact directory
- 不打开事务执行、预约、提交、代办、支付或工单能力
- 不通过 generic retrieval、raw notice HTML、OCR artifact 或对象存储 current JSON 作为
  online query path
- 不把 candidate taxonomy 本身当成 consumer admission 或 runtime opening

## Boundary Rules

- `regulation_candidate`: 稳定制度正文、办法、细则、规则、管理规定。
- `transport_schedule`: 班次、路线、方向、服务日、下一班、首末班、时刻表、运营窗口。
- `service_guide`: 怎么办理、材料、入口、预约说明、适用人群、服务时间作为 guide fact。
- `contact_directory`: 电话、邮箱、办公地点、联系人、值班电话。
- `service_status`: 当前或某一有效窗口内的开放、关闭、暂停、恢复、维护、受限服务、临时调整。
- `notice_level_query`: 只能作为 notice 阅读或低深度 title/url 卡片的通知，不形成 service status
  typed current truth。

## Success Criteria

1. 新 workstream 以 native `.planning/workstreams/<slug>/` 形式存在，并在
   `.planning/WORKSTREAMS.md` Active 表登记。
1. Phase 1 形成 selected admission cohort，样本覆盖 facility、IT、library、 service
   counter 与 transport-adjacent 边界。
1. `service_status_records` schema 可以表达服务主体、状态、有效窗口、作用范围、 source refs、status
   note、rejected reason 与冲突证据。
1. materializer 对缺少服务主体、缺少有效时间、来源冲突、过期窗口、非 service-status 通知 fail closed，不生成
   current record。
1. release path 对齐 ADR-0044：versioned artifact + PG release row + typed read
   model + current pointer transaction；stage 不移动 current。
1. `service_status_lookup` 不读 raw notice，不读对象存储 current JSON，不回退 RAG。
1. public-chat 展示用户可理解的服务状态、有效期和来源通知，不暴露 release id、 raw internal locator 或技术字段。
1. final acceptance evidence 记录 deterministic tests、selected cohort、live
   publishable service-status admission、rejected report、preview/stage/promote、
   release/read-model smoke、runtime eval verdict 与 product answer verdict。没有真实
   live downstream loop 证据时不得关闭 workstream。

## Verification Baseline

默认局部验证命令：

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres
```

后续 phase 可按实际变更追加：

```bash
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent
pnpm --dir apps/app-api test:node -- chat-command.service.core.structured.suite.ts
```
