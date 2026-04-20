---
phase: "4"
name: "Internal Query Service And Supervisor Handoff Wiring"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 4 Summary

## What Closed

- 把 `Phase 4` 的 execution-side owner boundary 从 planning truth 推进成代码 seam：
  - 新增 [campus-services-agent](/home/reptilian/code/campus-agent/packages/campus-services-agent)
  - 新增 [notice-agent](/home/reptilian/code/campus-agent/packages/notice-agent)
- 在 shared contract 冻结了 forward runtime handoff 所需的最小扩张，但没有扩张 `app-api -> supervisor-api` request seam：
  - [models.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/models.py) 现已接受 `campus-services-agent` / `notice-agent`
  - `SpecialistRequest` 现已接受 `allowed_tools`
- 在 `supervisor-core` 冻结了 current-truth 到 forward runtime family 的过渡 wiring：
  - [routing.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/routing.py) 新增 `specialist_payload` / `allowed_tools`
  - [framing.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/framing.py) 现已支持 preframed structured runtime handoff
  - [tool_policy.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/tool_policy.py) 现已把 per-agent `allowed_tools` 变成 code-owned enforcement seam
  - [agent.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/agent.py) 默认 delegate map 现已接入两个新 runtime agent owner package
- 在 owner package 内冻结了 internal query service + thin tool adapter 的 implementation direction：
  - `campus-services-agent`
    - `CampusServicesQueryService`
    - `ServiceStatusQuery`
    - `TransportScheduleQuery`
    - thin adapter + delegate
  - `notice-agent`
    - `NoticeQueryService`
    - `NoticeDiscoverQuery`
    - `NoticeGetQuery`
    - thin adapter + delegate
- 本 phase 没有重开这些边界：
  - `app-api` 不直接拥有 query service / tool adapter
  - `supervisor-core` 不直接拥有 structured truth query
  - 不走 browser/public API
  - 不走 `app-api` loopback HTTP
  - 不打开 query-serving surface

## Fresh Evidence

- [models.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/models.py)
- [__init__.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/__init__.py)
- [agent.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/agent.py)
- [routing.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/routing.py)
- [framing.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/framing.py)
- [tool_policy.py](/home/reptilian/code/campus-agent/packages/supervisor-core/src/campus_supervisor_core/tool_policy.py)
- [campus-services-agent](/home/reptilian/code/campus-agent/packages/campus-services-agent)
- [notice-agent](/home/reptilian/code/campus-agent/packages/notice-agent)
- [test_campus_services_agent.py](/home/reptilian/code/campus-agent/tests/specialist/test_campus_services_agent.py)
- [test_notice_agent.py](/home/reptilian/code/campus-agent/tests/specialist/test_notice_agent.py)
- [test_supervisor_core.py](/home/reptilian/code/campus-agent/tests/supervisor/test_supervisor_core.py)
- `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.specialist.test_availability_specialist tests.specialist.test_navigation_specialist tests.specialist.test_campus_services_agent tests.specialist.test_notice_agent tests.test_workspace_layout`
- `uv run --all-packages python -m unittest tests.api.test_supervisor_api`
- `git diff --check -- .planning/workstreams/campus-services-notices-runtime-admission/STATE.md .planning/WORKSTREAMS.md packages/supervisor-core/README.md packages/supervisor-core/pyproject.toml packages/supervisor-core/src/campus_supervisor_core/agent.py packages/contracts/src/campus_contracts/models.py packages/contracts/src/campus_contracts/__init__.py packages/supervisor-core/src/campus_supervisor_core/framing.py packages/supervisor-core/src/campus_supervisor_core/routing.py packages/supervisor-core/src/campus_supervisor_core/tool_policy.py packages/supervisor-core/src/campus_supervisor_core/errors.py packages/supervisor-core/src/campus_supervisor_core/__init__.py packages/campus-services-agent/README.md packages/campus-services-agent/pyproject.toml packages/campus-services-agent/src/campus_services_agent/__init__.py packages/campus-services-agent/src/campus_services_agent/query_service.py packages/campus-services-agent/src/campus_services_agent/tool_adapter.py packages/campus-services-agent/src/campus_services_agent/service.py packages/notice-agent/README.md packages/notice-agent/pyproject.toml packages/notice-agent/src/campus_notice_agent/__init__.py packages/notice-agent/src/campus_notice_agent/query_service.py packages/notice-agent/src/campus_notice_agent/tool_adapter.py packages/notice-agent/src/campus_notice_agent/service.py tests/specialist/test_campus_services_agent.py tests/specialist/test_notice_agent.py tests/supervisor/test_supervisor_core.py`

## Handoff

- `Phase 4` 现已正式 completed。
- 下一阶段固定进入 `Phase 5: Verification And Opening Gate`。
- `Phase 5` 不负责回退重开 handoff / adapter / query service owner 讨论；它只负责冻结 opening 之前必须满足的 eval、observability、fail-close 与 historical downgrade evidence。
