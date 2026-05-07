---
doc_type: reference_inventory
workstream: academic-calendar-campus-services-consolidation
phase: phase-0-inventory-and-boundary-freeze
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Reference Inventory: Academic Calendar Campus Services Consolidation

## Evidence Command

```bash
rg -n "calendar-agent|academic_calendar|academic_calendar_lookup|packages/calendar-agent|campus-calendar-agent|SUPERVISOR_API_OPEN_CAPABILITIES=.*academic_calendar" configs docs apps packages tests .planning pyproject.toml uv.lock
```

## Classification

- `migrate`: change runtime ownership from `calendar-agent` / `academic_calendar` to
  `campus-services-agent` / `campus_services`.
- `delete`: remove standalone calendar-agent runtime code, dependency, packaging or fixture
  expectation.
- `keep_data_plane`: preserve `calendar/academic_calendar` source truth, projection, read model,
  release task or ingestion tests.
- `verify_external`: confirm whether a reference is an external published dependency before
  deciding whether to keep compatibility.

## Summary

| Area | Reference Group | Action | Notes |
| - | - | - | - |
| Runtime registry | `configs/runtime/agents.v1.json` | `migrate` / `delete` | Remove active `calendar-agent`; add `academic_calendar_lookup` to `campus-services-agent` payload/tool list. |
| Runtime registry | `configs/runtime/tools.v1.json` | `migrate` | Change `academic_calendar_lookup.owner_agent` to `campus-services-agent` and capability to `campus_services`; keep `runtime_posture=sdk_adapter_admitted`. |
| Contracts | `packages/contracts/src/campus_contracts/models_shared.py` | `migrate` / `delete` | Remove `calendar-agent` from `AgentTarget`; remove standalone `academic_calendar` requested capability if no compatibility dependency is found. Keep payload/result DTOs. |
| Contracts | `docs/contracts/schemas/supervisor-execution.openapi.yaml` and generated Go/TS/Python artifacts | `migrate` / `delete` | Regenerate after removing standalone target/capability. This is internal execution contract, not a browser public surface. |
| Go runtime policy | `apps/supervisor-api/internal/runtimepolicy/*` | `migrate` | Academic calendar signals should infer `campus_services`; keep signal groups as subtype signals, not capability/lane truth. |
| Go planner | `apps/supervisor-api/internal/structuredplanning/*` | `migrate` | Plan academic calendar fact/guide signals as `campus-services-agent + academic_calendar_lookup`. |
| Go config/opening gate | `apps/supervisor-api/internal/config/config.go`, `internal/httpapi/readyz.go`, `internal/execution/request.go` | `migrate` / `delete` | Remove independent `academic_calendar` lane/open capability; academic calendar opens through `campus_services`. |
| Go structured query | `apps/supervisor-api/internal/structuredquery/academic_calendar_store.go`, `runtime_academic_calendar_test.go`, typed runtime status | `keep_data_plane` | Keep PostgreSQL current release/read-model query code. It is data/query backing, not runtime owner. |
| Python worker | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py` | `migrate` / `delete` | Remove `calendar-agent` delegate and route `AcademicCalendarLookupPayload` through campus-services delegate/SDK tool execution. |
| Python worker | `bridge_payload_codecs.py`, `tool_function_schema.py`, `agent_dispatch.py` | `migrate` | Keep payload codec/schema; make ownership consistent with campus-services target. |
| Python worker | `agents_sdk_instruction_profiles.py` | `migrate` | Replace calendar-agent profile text/target with campus-services academic calendar profile. |
| Python packaging | `apps/supervisor-agent-worker/pyproject.toml`, `Dockerfile`, `uv.lock` | `delete` / `migrate` | Remove `campus-calendar-agent` dependency, Docker copy, package path and lock entries after code moves. |
| Package | `packages/calendar-agent/*` | `delete` | Retire package after query service/tool adapter code is copied or folded into campus-services-agent. |
| Package | `packages/campus-services-agent/*` | `migrate` | Add academic calendar query type, HTTP query method, tool adapter handling, response shaping and guardrail projection. |
| Eval fixtures | `packages/evals/fixtures/workflow_trace_gate_cases.v1.json` | `migrate` | Change expected selected target and handoff target to `campus-services-agent`. |
| Eval gates | `packages/evals/src/campus_evals/*`, `tests/evals/*` | `migrate` | Fold academic calendar SDK/product path into campus-services gate; remove standalone calendar-agent expectations. |
| Supervisor tests | `tests/supervisor/*`, `apps/supervisor-api/internal/*_test.go` | `migrate` | Update registry, planner, policy, SDK and dispatch tests to target campus-services. |
| Docker tests | `tests/test_supervisor_api_local_runtime.py`, `tests/test_check_dockerfile_tracked.py` | `delete` / `migrate` | Stop expecting `packages/calendar-agent` in Docker build context. |
| Runtime smoke | `tests/test_supervisor_runtime_process_smoke.py`, academic calendar runtime smoke scripts/tests | `migrate` | Use `requested_capability=campus_services` and expect campus-services handoff. Keep projection smoke. |
| Docs | `docs/architecture/current-architecture.md`, `docs/architecture/system/execution-and-agents-architecture.md`, `docs/contracts/app-api-supervisor-execution.md`, `docs/environment/deploy-and-eval-readiness.md`, `apps/supervisor-api/README.md` | `migrate` | Remove `calendar-agent` as accepted runtime truth; document academic calendar as campus-services tool with `calendar/academic_calendar` backing. |
| Official web selected write | `configs/sources/official_web/muc_public/*`, `packages/official-web-core/*`, `apps/official-web-collector/*` | `migrate` / `keep_data_plane` | Keep `selected_write_target=calendar/academic_calendar`; update owner metadata from `calendar-agent` to `campus-services-agent` where present. |
| Ingestion calendar projection | `configs/ingestion/calendar/academic_calendar/*`, `packages/ingestion-core/*academic_calendar*`, ingestion worker selected-write code and tests | `keep_data_plane` | Do not rename collection, corpus, release target, read model or source-truth schema. |
| Prior workstreams | `.planning/workstreams/agents-sdk-*`, other completed planning docs | `keep_data_plane` / `do_not_edit_now` | Historical planning references are not active runtime truth. Avoid touching unrelated workstream archives unless a lint or truth update requires it. |

## Active Runtime References To Migrate Or Delete

### Registry And Contracts

- `configs/runtime/agents.v1.json`
  - `calendar-agent` is active.
  - `owner_package=packages/calendar-agent`.
  - `payload_kinds=["academic_calendar_lookup"]`.
  - `allowed_structured_handoff_tools=["academic_calendar_lookup"]`.
- `configs/runtime/tools.v1.json`
  - `academic_calendar_lookup.owner_agent=calendar-agent`.
  - `academic_calendar_lookup.capability=academic_calendar`.
- `packages/contracts/src/campus_contracts/models_shared.py`
  - `AgentTarget` includes `calendar-agent`.
  - `RequestedCapability` includes `academic_calendar`.
- `docs/contracts/schemas/supervisor-execution.openapi.yaml`
  - OpenAPI enum includes `calendar-agent` and `academic_calendar`.
  - Generated artifacts in Go, Python and TS mirror those enums.

### Go Runtime

- `apps/supervisor-api/internal/runtimepolicy/capability.go`
  - Academic calendar fact signals currently infer `academic_calendar`.
- `apps/supervisor-api/internal/runtimepolicy/policy_scope.go`
  - `academic_calendar` has separate domain candidate and task kind.
- `apps/supervisor-api/internal/runtimepolicy/policy.go`
  - Routing frame includes standalone `academic_calendar` domain candidates.
- `apps/supervisor-api/internal/runtimepolicy/tool_registry.go`
  - Static target-to-capability fallback maps `calendar-agent` to `academic_calendar`.
- `apps/supervisor-api/internal/structuredplanning/planner.go`
  - `EffectiveCapability == "academic_calendar"` plans `calendar-agent`.
- `apps/supervisor-api/internal/config/config.go`
  - Lane list and open capability parser include `academic_calendar`.
- `apps/supervisor-api/internal/execution/request.go`
  - Request projection admits `academic_calendar`.
- `apps/supervisor-api/internal/httpapi/readyz.go`
  - Readiness exposes independent `academic_calendar` capability gate.

### Python Worker

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py`
  - Imports `campus_calendar_agent`.
  - Builds `calendar_query_service`.
  - Registers `calendar-agent`.
  - Has a standalone `_delegate_to_calendar_agent`.
  - Has standalone SDK execution for `academic_calendar_lookup`.
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_instruction_profiles.py`
  - Has a calendar-agent instruction profile.
- `apps/supervisor-agent-worker/pyproject.toml`
  - Depends on `campus-calendar-agent`.
- `apps/supervisor-agent-worker/Dockerfile`
  - Copies `packages/calendar-agent`.
  - Adds it to `uv sync` package list and `PYTHONPATH`.

### Package Boundary

- `packages/calendar-agent`
  - Owns `delegate_to_calendar_agent`, `CalendarHTTPQueryService`, `CalendarQueryService`,
    `AcademicCalendarQuery` and calendar response shaping.
- `packages/campus-services-agent`
  - Does not yet include academic calendar query protocol, HTTP query method or tool adapter
    handling.

### Eval, Smoke And Tests

- `tests/supervisor/*`
  - Registry, tool registry, dispatch and SDK suites expect `calendar-agent`.
- `apps/supervisor-api/internal/*_test.go`
  - Runtime policy and planner tests expect independent `academic_calendar` capability and
    `calendar-agent`.
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`
  - Workflow trace fixture expects `selected_target=calendar-agent`.
- `tests/evals/multi_agent_product_path_eval_gate_profile_suite.py`
  - Academic calendar product profile expects `calendar-agent`.
- `tests/test_supervisor_runtime_process_smoke.py`
  - Smoke plan sends `requested_capability=academic_calendar` and expects `calendar-agent`.
- `tests/test_supervisor_api_local_runtime.py`
  - Docker test expects `packages/calendar-agent`.

## Data-Plane References To Keep

These references are not runtime-owner debt. They preserve the source-truth and projection owner:

- `configs/ingestion/calendar/academic_calendar/*`
- `packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/structured_projection_postgres.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/smoke_structured_projection_postgres.py`
- `apps/supervisor-api/internal/structuredquery/academic_calendar_store.go`
- `apps/supervisor-api/internal/structuredquery/runtime_academic_calendar_test.go`
- `tests/test_publish_academic_calendar_projection.py`
- `tests/test_academic_calendar_selected_write_runtime_smoke.py`

The collection/corpus identity remains:

```text
calendar/academic_calendar
```

## Metadata References To Migrate But Not Rename

Official-web selected-write metadata currently uses academic calendar as a target surface. The
selected write target must remain `calendar/academic_calendar`, but owner metadata should reflect
the new runtime owner where present:

- `configs/sources/official_web/muc_public/consumer-denominator.json`
- `configs/sources/official_web/muc_public/target-inventory.json`
- `packages/official-web-core/test/*`
- `apps/official-web-collector/test/test-support.ts`

## External Compatibility Findings

No repo evidence shows a browser-facing, published external contract that requires:

- `target=calendar-agent`
- `requested_capability=academic_calendar`
- `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar`

The references found are internal runtime contracts, generated internal adapters, local smoke
profiles, tests, docs and previous workstream planning. They can migrate without aliasing.
