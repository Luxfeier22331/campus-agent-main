---
phase: "3"
name: "Structured Truth Admission And Query Projection Freeze"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 3 Summary

## What Closed

- 把 `Phase 3` 的 projection truth owner 写进长期文档，不再只留在 phase-local planning：
  - [campus-services-notices-runtime-admission.md](/home/reptilian/code/campus-agent/docs/plans/archive/completed/campus-services-notices-runtime-admission.md)
  - [execution-and-agents-architecture.md](/home/reptilian/code/campus-agent/docs/architecture/system/execution-and-agents-architecture.md)
  - [retrieval-serving-architecture.md](/home/reptilian/code/campus-agent/docs/architecture/system/retrieval-serving-architecture.md)
  - [official-web-serving-and-news-retrieval-strategy.md](/home/reptilian/code/campus-agent/docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md)
  - [internal-notice-offline-preparation-strategy.md](/home/reptilian/code/campus-agent/docs/reference/internal-notice-offline-preparation-strategy.md)
- 固定了 `service_status_lookup` / `transport_schedule_lookup` 的 truth owner：
  - 前者只读 current-effective status projection
  - 后者只读 route / service window / stop ref projection
  - 两者都不回退到 generic RAG 或 `service_catalog` 文本检索
- 固定了 `campus_notice_discover/get` 的 source-family-aware projection split：
  - public `official_web` notice-like projection
  - restricted `campus_notices/internal_notice` projection
- 固定了 future internal query service seam 的禁止项：
  - 不读 query-disabled retrieval alias
  - 不扫 raw / source-truth bundle
  - 不走 browser-facing API
  - 不走 `app-api` loopback HTTP

## Fresh Evidence

- [campus-services-notices-runtime-admission.md](/home/reptilian/code/campus-agent/docs/plans/archive/completed/campus-services-notices-runtime-admission.md)
- [execution-and-agents-architecture.md](/home/reptilian/code/campus-agent/docs/architecture/system/execution-and-agents-architecture.md)
- [retrieval-serving-architecture.md](/home/reptilian/code/campus-agent/docs/architecture/system/retrieval-serving-architecture.md)
- [official-web-serving-and-news-retrieval-strategy.md](/home/reptilian/code/campus-agent/docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md)
- [internal-notice-offline-preparation-strategy.md](/home/reptilian/code/campus-agent/docs/reference/internal-notice-offline-preparation-strategy.md)
- `git diff --check -- docs/plans/archive/completed/campus-services-notices-runtime-admission.md docs/architecture/system/execution-and-agents-architecture.md docs/architecture/system/retrieval-serving-architecture.md docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md docs/reference/internal-notice-offline-preparation-strategy.md`

## Handoff

- `Phase 3` 现已正式 completed。
- 下一阶段固定进入 `Phase 4: Internal Query Service And Supervisor Handoff Wiring`。
- `Phase 4` 只负责冻结 implementation direction：internal query service、thin tool adapter、supervisor handoff、per-agent `allowed_tools` 与 execution ownership，不提前进入 opening gate。
