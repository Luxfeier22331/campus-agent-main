---
phase: "2"
name: "Tool Contract Freeze"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 2 Summary

## What Closed

- 在 [models.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/models.py) 为首发 `4` 个 tool 落下 dedicated shared contract：
  - `ServiceStatusLookupPayload` / `ServiceStatusLookupResult`
  - `TransportScheduleLookupPayload` / `TransportScheduleLookupResult`
  - `CampusNoticeDiscoverPayload` / `CampusNoticeDiscoverResult`
  - `CampusNoticeGetPayload` / `CampusNoticeGetResult`
- 冻结了 tool-level shared vocabulary：
  - `TemporalQuery`
  - `ToolBusinessOutcome`
  - `ToolFailCloseReason`
  - `HistoricalDowngradeReason`
  - `NoticeSourceFamily`
- 冻结了 notice runtime 的分层输出 shape：
  - `discover` 返回 `NoticeCard` 列表与 historical downgrade / fail-close 结果
  - `get` 返回 canonical notice body、source family、source URL 与 provenance placeholder
- 扩张了 shared seam，但没有重开 family label 讨论：
  - `SpecialistRequest.payload`
  - `SpecialistResponse.result`
  - `SupervisorResponse.result`
  已接受新 tool contract union，同时 current-truth `SpecialistTarget` 仍保持 `rag-specialist` / `availability-specialist` / `navigation-specialist`
- 没有打开任何新的 query-enabled surface，也没有提前实现 runtime wiring、query service 或 tool adapter

## Fresh Evidence

- [models.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/models.py)
- [__init__.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/__init__.py)
- [test_models.py](/home/reptilian/code/campus-agent/tests/contracts/test_models.py)
- `uv run --all-packages python -m unittest tests.contracts.test_models`
- `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.supervisor.test_supervisor_core tests.specialist.test_availability_specialist tests.specialist.test_navigation_specialist`

## Handoff

- `Phase 2` 现已正式 completed。
- 下一阶段固定进入 `Phase 3: Structured Truth Admission And Query Projection Freeze`。
- `Phase 3` 只负责冻结这 `4` 个 tool 各自消费的 source-truth / normalized-truth lane、projection shape 与 query projection filter，不提前跳到 runtime wiring 或 opening gate。
