---
workstream: campus-services-notices-runtime-admission
created: 2026-04-20
updated: 2026-04-21
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Complete
**Current Phase Name:** Closed Out After Phase 7
**Current Plan:** `<none>`
**Total Phases:** 7
**Total Plans in Phase:** 0
**Progress:** 7/7 phases complete
**Last Activity:** 2026-04-21
**Last Activity Description:** Completed `Phase 7`, closed the final `service_process_lookup` admission gap, and moved the workstream to completed truth.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/CONTEXT.md`
  - research: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/RESEARCH.md`
  - plan: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/PLAN.md`
- summary: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/SUMMARY.md`
- completed `Phase 2` artifacts:
  - context: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/CONTEXT.md`
  - research: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/RESEARCH.md`
  - plan: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/PLAN.md`
  - summary: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-2-tool-contract-freeze/SUMMARY.md`
- completed `Phase 3` artifacts:
  - context: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/CONTEXT.md`
  - research: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/RESEARCH.md`
  - plan: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/PLAN.md`
  - summary: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-3-structured-truth-admission-and-query-projection-freeze/SUMMARY.md`
- created `Phase 4` artifacts:
  - context: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/CONTEXT.md`
  - research: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/RESEARCH.md`
  - plan: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/PLAN.md`
  - summary: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/SUMMARY.md`
- completed `Phase 5` artifacts:
  - context: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/CONTEXT.md`
  - research: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/RESEARCH.md`
  - plan: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/PLAN.md`
  - summary: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/SUMMARY.md`
- completed `Phase 6` artifacts:
  - context: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/CONTEXT.md`
  - research: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/RESEARCH.md`
  - plan: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/PLAN.md`
  - summary: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/SUMMARY.md`
- `Phase 6` 已正式 completed：
  - `contact_directory_lookup` 的 bounded query class 已冻结
  - `campus_services/contact_directory` 的 semantic-owner truth / provenance 已冻结
  - `official_web/stable_reference` 与 structured contact runtime 的边界已冻结
- completed `Phase 7` artifacts:
  - context: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/CONTEXT.md`
  - research: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/RESEARCH.md`
  - plan: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/PLAN.md`
  - summary: `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/SUMMARY.md`
- `Phase 7` 已正式 completed：
  - `service_process_lookup` 的 bounded query class 已冻结
  - `campus_services/service_catalog` 的 process-oriented semantic-owner truth 已冻结
  - `contact_directory_lookup` / `service_status_lookup` / `service_process_lookup` 的分工已冻结
- `Phase 4` code seam 已开始落地：
  - `packages/contracts` 现已接受 forward target labels `campus-services-agent` / `notice-agent`
  - `SpecialistRequest` 现已接受 `allowed_tools`
  - `packages/supervisor-core` 现已按 target enforce code-owned tool subset
  - `RoutingDecision.specialist_payload` + `allowed_tools` 现已支持 preframed structured runtime handoff，而不扩张 `SupervisorRequest`
  - `packages/campus-services-agent` 现已落下 `CampusServicesQueryService` protocol、`ServiceStatusQuery` / `TransportScheduleQuery`、package-owned thin tool adapter 与 `delegate_to_campus_services_agent(...)`
  - `packages/notice-agent` 现已落下 `NoticeQueryService` protocol、`NoticeDiscoverQuery` / `NoticeGetQuery`、package-owned thin tool adapter 与 `delegate_to_notice_agent(...)`
  - `packages/supervisor-core` 默认 delegate map 现已接上这两个 forward runtime agent owner package
- `Phase 4` 已正式 completed：
  - internal query service interface truth 已冻结
  - tool adapter owner 与职责已冻结
  - supervisor handoff / `allowed_tools` / execution ownership 已冻结
- `Phase 1` 已冻结：
  - `supervisor` / `campus-services-agent` / `notice-agent` / `navigation-agent` / `rag-specialist` 的 capability boundary
  - current-truth `*-specialist` 与 target-side `*-agent` 的 label coexistence rule
  - notice runtime source matrix
  - `current/latest/effective/current-year miss` 的 fail-close 语义
- `Phase 2` 已收口的 contract truth：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- `packages/contracts` 现已新增并导出：
  - `TemporalQuery`
  - `NoticeCard`
  - `ServiceStatusLookupPayload` / `ServiceStatusLookupResult`
  - `TransportScheduleLookupPayload` / `TransportScheduleLookupResult`
  - `CampusNoticeDiscoverPayload` / `CampusNoticeDiscoverResult`
  - `CampusNoticeGetPayload` / `CampusNoticeGetResult`
- `SpecialistRequest.payload` 与 `SpecialistResponse.result` / `SupervisorResponse.result` 已接受这四个 tool 的 shared contract union；shared contract 也已接受 forward runtime agent labels，但产品主路径 routing 仍未自然切到它们。
- `Phase 3` 已收口的 structured truth：
  - `service_status_lookup` 只读 current-effective status projection
  - `transport_schedule_lookup` 只读 route / service window / stop ref projection
  - `campus_notice_discover/get` 继续显式区分 public `official_web` notice projection 与 restricted `internal_notice` notice projection
  - future internal query service 只读 projection / normalized truth，不得读取 raw/source bundle、query-disabled alias、browser API 或 `app-api` loopback HTTP
- `Phase 4` 当前 execution focus 固定为 wiring direction freeze：
  - `app-api` 不直接拥有 query service 或 tool adapter
  - `supervisor-core` 不直接拥有 structured truth query
  - future `campus-services-agent` / `notice-agent` handoff、tool adapter 与 `allowed_tools` 需要成为 code-owned seam
- 已落盘的 closeout truth：
  - `docs/plans/archive/completed/campus-services-notices-runtime-admission.md` 现已显式补上 current-vs-target label mapping、notice source matrix 与 temporal fail-close freeze
  - `docs/architecture/execution-and-specialists-architecture.md` / `docs/architecture/target-architecture.md` 现已显式承认 current-truth `*-specialist` 与 target-side `*-agent` family label 的短期并存边界
  - `docs/architecture/official-web-serving-and-news-retrieval-strategy.md` / `docs/reference/internal-notice-offline-preparation-strategy.md` 现已显式写出 public notice source family 与 restricted notice source family 的边界，不再让 `fresh_news` opening 或 `internal_notice` posture 隐式替代 notice runtime contract
- `Phase 5` 已正式 completed：
  - opening gate 的 verification matrix 已冻结
  - structured runtime 的 minimal observability summary 已冻结
  - gate-closed / gate-open criteria 已冻结
- 当前仍然不做：
  - projection-backed backing query implementation
  - `service_catalog`、`internal_notice`、`fresh_news` query-serving opening
  - `transport_notice_latest` / `transport_pickup_point_lookup` 提前 admission

## Blockers

- 当前 merged truth 尚无这些 structured runtime capability 的 projection-backed backing query implementation。
- 当前产品主路径 routing 仍未自然把 campus service / notice 问句切到这些 forward runtime agent。
- `campus_services` 与 notice 相关 source 目前仍未以 repo-admitted runtime lane 开放给产品主路径。
- `contact_directory_lookup` 已有 admission truth，但仍未进入 shared contract / runtime implementation。
- `service_process_lookup` 已有 admission truth，但仍未进入 shared contract / runtime implementation。

## Verification

- `git diff --check -- .planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md .planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md .planning/workstreams/campus-services-notices-runtime-admission/STATE.md docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.specialist.test_navigation_specialist`
- `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist.RagSpecialistTest.test_official_web_no_evidence_uses_scope_specific_no_answer_copy tests.specialist.test_rag_specialist.RagSpecialistTest.test_official_web_freshness_sensitive_query_uses_scope_specific_fail_close_copy`
- `git diff --check -- .planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md .planning/workstreams/campus-services-notices-runtime-admission/STATE.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/CONTEXT.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/RESEARCH.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/PLAN.md docs/plans/archive/completed/campus-services-notices-runtime-admission.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/target-architecture.md docs/architecture/official-web-serving-and-news-retrieval-strategy.md docs/reference/internal-notice-offline-preparation-strategy.md`
- `uv run --all-packages python -m unittest tests.contracts.test_models`
- `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.supervisor.test_supervisor_core tests.specialist.test_navigation_specialist`
- `git diff --check -- docs/plans/archive/completed/campus-services-notices-runtime-admission.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/retrieval-serving-architecture.md docs/architecture/official-web-serving-and-news-retrieval-strategy.md docs/reference/internal-notice-offline-preparation-strategy.md`
- `uv run --all-packages python -m unittest tests.contracts.test_models tests.supervisor.test_supervisor_core tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.specialist.test_navigation_specialist tests.specialist.test_campus_services_agent tests.specialist.test_notice_agent tests.test_workspace_layout`
- `uv run --all-packages python -m unittest tests.api.test_supervisor_api`
- `git diff --check -- .planning/workstreams/campus-services-notices-runtime-admission/STATE.md .planning/WORKSTREAMS.md packages/contracts/src/campus_contracts/models.py packages/contracts/src/campus_contracts/__init__.py packages/supervisor-core/src/campus_supervisor_core/agent.py packages/supervisor-core/src/campus_supervisor_core/framing.py packages/supervisor-core/src/campus_supervisor_core/routing.py packages/supervisor-core/src/campus_supervisor_core/tool_policy.py packages/supervisor-core/src/campus_supervisor_core/errors.py packages/supervisor-core/src/campus_supervisor_core/__init__.py packages/supervisor-core/pyproject.toml packages/campus-services-agent/pyproject.toml packages/campus-services-agent/src/campus_services_agent/__init__.py packages/campus-services-agent/src/campus_services_agent/query_service.py packages/campus-services-agent/src/campus_services_agent/tool_adapter.py packages/campus-services-agent/src/campus_services_agent/service.py packages/notice-agent/pyproject.toml packages/notice-agent/src/campus_notice_agent/__init__.py packages/notice-agent/src/campus_notice_agent/query_service.py packages/notice-agent/src/campus_notice_agent/tool_adapter.py packages/notice-agent/src/campus_notice_agent/service.py tests/specialist/test_campus_services_agent.py tests/specialist/test_notice_agent.py tests/supervisor/test_supervisor_core.py`
- `git diff --check -- docs/plans/archive/completed/campus-services-notices-runtime-admission.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/operator-observability-architecture.md docs/contracts/app-api-supervisor-execution.md .planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md .planning/workstreams/campus-services-notices-runtime-admission/STATE.md .planning/WORKSTREAMS.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-5-verification-and-opening-gate/SUMMARY.md`
- `git diff --check -- docs/plans/archive/completed/campus-services-notices-runtime-admission.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/retrieval-serving-architecture.md docs/architecture/official-web-serving-and-news-retrieval-strategy.md docs/reference/runtime-serving-and-index-terms.md .planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md .planning/workstreams/campus-services-notices-runtime-admission/STATE.md .planning/WORKSTREAMS.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/CONTEXT.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/RESEARCH.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/PLAN.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-6-contact-directory-lookup-admission/SUMMARY.md`
- `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile tests.test_workspace_layout`
- `git diff --check -- docs/plans/archive/completed/campus-services-notices-runtime-admission.md docs/architecture/execution-and-specialists-architecture.md docs/architecture/retrieval-serving-architecture.md docs/architecture/official-web-serving-and-news-retrieval-strategy.md docs/reference/runtime-serving-and-index-terms.md .planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md .planning/workstreams/campus-services-notices-runtime-admission/STATE.md .planning/WORKSTREAMS.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/CONTEXT.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/RESEARCH.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/PLAN.md .planning/workstreams/campus-services-notices-runtime-admission/phases/phase-7-service-process-lookup-admission/SUMMARY.md`
- 当前已实现 shared contract、forward runtime agent package、query service protocol、thin adapter 与 default supervisor delegate wiring，但 backing query implementation 与产品主路径 routing 仍未完成
- 当前 contact-directory truth 已冻结为 later-wave structured runtime candidate，但 shared contract、runtime adapter 与 product-path routing 仍未实现
- 当前 service-process truth 已冻结为 later-wave structured runtime candidate，但 shared contract、runtime adapter 与 product-path routing 仍未实现

## Session Continuity

**Stopped At:** workstream 已在 `Phase 7` 完成收口；后续只有在新的 runtime capability family admission、或已冻结边界被显式改写时才恢复
**Resume File:** `<none>`
