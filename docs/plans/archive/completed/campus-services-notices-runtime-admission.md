---
doc_type: plan
status: completed
created: 2026-04-20
updated: 2026-04-21
---

# Campus Services Notices Runtime Admission

## Completion Note

这条 `campus_services / campus_notice` runtime admission workstream 已关闭。
它完成的是 runtime capability family、首发 tool contract、later-wave bounded tool admission、
projection-backed internal query service seam，以及 supervisor handoff / ownership boundary 的 planning closeout。

## What This Plan Closed

- 固定 `campus-services-agent`、`notice-agent`、`navigation-agent` 与 `rag-specialist` 的边界
- 冻结首发 `4` 个 tool：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- 冻结 later-wave `contact_directory_lookup` 与 `service_process_lookup` 的 admission truth
- 收口 `allowed_tools`、structured handoff、thin tool adapter 与 internal query service protocol 的 execution seam
- 固定 fail-close、historical downgrade、notice source family 与 opening gate 口径

## Current Canonical Entry

- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `docs/plans/README.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在产品范围重新 admission 新的 runtime capability family、
显式改写已冻结的 tool / ownership / opening-gate truth，
或需要把 `contact_directory_lookup` / `service_process_lookup` 从 admission freeze 推进到新的实施 workstream 时，
才应恢复这条 workstream。
