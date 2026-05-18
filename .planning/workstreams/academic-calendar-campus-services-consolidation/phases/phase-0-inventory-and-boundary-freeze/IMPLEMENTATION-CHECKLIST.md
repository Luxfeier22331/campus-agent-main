---
doc_type: implementation_checklist
workstream: academic-calendar-campus-services-consolidation
phase: phase-0-inventory-and-boundary-freeze
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Implementation Checklist: Academic Calendar Campus Services Consolidation

## Phase 1: Registry, Go Routing And Contract Reassignment

Goal: make canonical registries, Go runtime/planner and internal execution contracts state the new
owner in one independently verifiable slice.

- Update `configs/runtime/agents.v1.json`.
  - Remove active `calendar-agent`.
  - Add `academic_calendar_lookup` to `campus-services-agent.payload_kinds`.
  - Add `academic_calendar_lookup` to `campus-services-agent.allowed_structured_handoff_tools`.
  - Add or preserve `calendar_fact` under campus-services context projection kinds only if still
    needed by trace/projection evidence.
- Update `configs/runtime/tools.v1.json`.
  - Set `academic_calendar_lookup.owner_agent=campus-services-agent`.
  - Set `academic_calendar_lookup.capability=campus_services`.
  - Keep `backend=internal_structured_query_service`.
  - Keep `runtime_posture=sdk_adapter_admitted`.
- Update `packages/contracts/src/campus_contracts/models_shared.py`.
  - Remove `calendar-agent` from `AgentTarget`.
  - Remove `academic_calendar` from `RequestedCapability`.
  - Keep `academic_calendar_lookup` in tool names.
- Update `docs/contracts/schemas/supervisor-execution.openapi.yaml`.
  - Remove `calendar-agent` from `AgentTarget`.
  - Remove `academic_calendar` from `RequestedCapability`.
  - Regenerate Go/TS/Python contract artifacts using the repo generator.
- Update Go runtime policy and planner before contract enum removal is considered complete.
  - `apps/supervisor-api/internal/runtimepolicy/capability.go`
  - `apps/supervisor-api/internal/runtimepolicy/policy_scope.go`
  - `apps/supervisor-api/internal/runtimepolicy/policy.go`
  - `apps/supervisor-api/internal/runtimepolicy/tool_registry.go`
  - `apps/supervisor-api/internal/structuredplanning/planner.go`
  - Academic calendar fact signals infer `campus_services`.
  - Planner selects `campus-services-agent + academic_calendar_lookup`.
  - `AllowedToolsForPayloadKind` uses `campus-services-agent`.
- Update runtime config, request projection and readiness gates.
  - `apps/supervisor-api/internal/config/config.go`
  - `apps/supervisor-api/internal/execution/request.go`
  - `apps/supervisor-api/internal/httpapi/readyz.go`
  - Remove `academic_calendar` from lane names.
  - Remove `academic_calendar` from open capability parser.
  - Remove `academic_calendar` from request capability admission.
  - Remove independent `academic_calendar` readiness gate.
  - Ensure `campus_services` readiness covers active academic calendar backing health.
- Update registry tests.
  - `tests/supervisor/agent_spec_registry_suite.py`
  - `tests/supervisor/tool_spec_registry_suite.py`
  - `apps/supervisor-api/internal/runtimepolicy/agent_registry_test.go`
  - `apps/supervisor-api/internal/runtimepolicy/tool_registry_test.go`
- Update Go policy/planner/config/readiness tests.
  - Academic calendar examples infer `campus_services`.
  - Explicit old `requested_capability=academic_calendar` fails closed.
  - `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar` fails config validation.
  - `SUPERVISOR_API_OPEN_CAPABILITIES=campus_services` admits the planned calendar lookup path when
    backing readiness is healthy.

Exit proof:

```bash
uv run --all-packages python -m unittest tests.supervisor.agent_spec_registry_suite tests.supervisor.tool_spec_registry_suite -q
uv run --all-packages python -m scripts.generate_supervisor_execution_contracts
cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/config ./internal/execution ./internal/httpapi
```

## Phase 2: Python Worker And Package Consolidation

Goal: execute academic calendar lookup through campus-services-agent and retire calendar-agent code.

- Extend `packages/campus-services-agent`.
  - Add `AcademicCalendarQuery`.
  - Add `lookup_academic_calendar` to `CampusServicesQueryService`.
  - Add HTTP query service method for `/internal/query/calendar/academic-calendar`.
  - Add tool adapter dispatch for `AcademicCalendarLookupPayload`.
  - Move response shaping and observability projection from `packages/calendar-agent`.
  - Set response target to `campus-services-agent`.
  - Set projection owner to `campus-services-agent`.
- Update `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py`.
  - Remove `campus_calendar_agent` imports.
  - Remove `_build_calendar_query_service`.
  - Remove `calendar-agent` delegate registration.
  - Add `academic_calendar_lookup` to `_execute_campus_services_tool`.
- Update `agents_sdk_instruction_profiles.py`.
  - Replace calendar-agent profile with campus-services academic calendar profile.
  - Select it when `request.target == "campus-services-agent"` and allowed tool includes
    `academic_calendar_lookup`.
- Update packaging.
  - Remove `campus-calendar-agent` from `apps/supervisor-agent-worker/pyproject.toml`.
  - Remove Docker copy/package/PYTHONPATH references to `packages/calendar-agent`.
  - Remove `packages/calendar-agent` from workspace membership and refresh `uv.lock`.
  - Delete `packages/calendar-agent` after imports are gone.
- Update Python tests.
  - `tests/supervisor/agent_dispatch_suite.py`
  - `tests/supervisor/agents_sdk_tool_bridge_suite.py`
  - `tests/supervisor/agents_sdk_runtime_policy_suite.py`
  - `tests/supervisor/agents_sdk_notice_get_pilot_suite.py`
  - `tests/contracts/contract_models_services_and_notice_suite.py`
  - `tests/test_supervisor_api_local_runtime.py`
  - `tests/test_check_dockerfile_tracked.py`

Exit proof:

```bash
uv sync --all-packages --dev
uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.agents_sdk_notice_get_pilot_suite tests.contracts.contract_models_services_and_notice_suite tests.test_supervisor_api_local_runtime tests.test_check_dockerfile_tracked -q
uv run --all-packages ruff check apps/supervisor-agent-worker packages/campus-services-agent tests/supervisor
```

## Phase 3: Eval, Smoke And Product Gate Rewrite

Goal: make validation expect campus-services ownership.

- Update `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`.
  - `selected_target=campus-services-agent`.
  - handoff target `campus-services-agent`.
  - selected tool remains `academic_calendar_lookup`.
- Update SDK promotion/product path gate fixtures.
  - Keep `academic_calendar_lookup` in campus-services SDK adoption matrix.
  - Remove standalone calendar-agent expectations.
- Update process smoke.
  - Use `requested_capability=campus_services`.
  - Expect `campus-services-agent`, `academic_calendar_lookup`, `single_handoff`,
    `sdk_completed`.
- Keep data-plane smoke that verifies `calendar/academic_calendar` projection/read-model.
- Update test names/profiles only if the old profile name encodes standalone capability ownership.

Exit proof:

```bash
uv run --all-packages python -m unittest tests.evals.agents_sdk_promotion_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.test_supervisor_runtime_process_smoke -q
```

## Phase 4: Docs, Metadata And Cleanup

Goal: remove stale architecture truth and source metadata owner drift.

- Update architecture docs.
  - `docs/architecture/current-architecture.md`
  - `docs/architecture/system/execution-and-agents-architecture.md`
  - `docs/architecture/domains/campus-services/architecture.md`
  - `docs/architecture/system/data-plane-architecture.md`
- Update execution contract docs.
  - `docs/contracts/app-api-supervisor-execution.md`
  - `apps/supervisor-api/README.md`
  - `docs/environment/deploy-and-eval-readiness.md`
- Update official-web source metadata.
  - Keep `owner_surface=academic_calendar_lookup`.
  - Keep `selected_write_target=calendar/academic_calendar`.
  - Change `owner_agent_or_runtime` to `campus-services-agent` where present.
- Update tests for official-web config metadata.
- Update workstream state with Phase 4 evidence, but do not mark the workstream completed until
  Phase 5 passes.

Exit proof:

```bash
pnpm docs:lint
pnpm web:test -- --runInBand
```

## Phase 5: Final Verification And Closeout

Goal: prove no active runtime owner drift remains.

- Run focused Go/Python/eval/docs verification lanes.
- Run end-state search for removed names.
- Confirm data-plane names remain.
- Record verification evidence in `STATE.md`.
- Move workstream to completed.

Exit proof:

```bash
cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/httpapi ./internal/execution ./internal/structuredquery
uv sync --all-packages --dev
uv run --all-packages python -m unittest discover -s tests -t .
pnpm docs:lint
git diff --check
```

## End-State Search Expectations

After completion:

```bash
rg -n "calendar-agent|packages/calendar-agent|campus-calendar-agent|requested_capability.*academic_calendar|SUPERVISOR_API_OPEN_CAPABILITIES=.*academic_calendar" configs docs apps packages tests pyproject.toml uv.lock
```

Expected result:

- no active runtime/code/test/package references
- only historical workstream archive references if intentionally left

Data-plane search remains expected to return results:

```bash
rg -n "calendar/academic_calendar|academic_calendar_lookup|academic_calendar_read_model" configs docs apps packages tests
```
