---
doc_type: roadmap
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Academic Calendar Campus Services Consolidation

## Phase Status

- [x] **Phase 0: Inventory And Boundary Freeze** — inventory current calendar ownership, decide
  whether any external compatibility exists, and freeze no-alias migration rules.
- [x] **Phase 1: Registry, Go Routing And Contract Reassignment** — atomically move
  `academic_calendar_lookup` under `campus-services-agent` in AgentSpec/ToolSpec, collapse
  independent Go `academic_calendar` capability/lane/opening semantics, and remove the stale
  internal contract enum values only after planner/runtime no longer emit them.
- [x] **Phase 2: Python Worker And Package Consolidation** — move execution from calendar delegate
  to campus-services delegate and retire `packages/calendar-agent` as active owner.
- [x] **Phase 3: Eval, Smoke And Product Gate Rewrite** — update workflow trace fixtures, SDK gates,
  product-path tests and readyz expectations.
- [x] **Phase 4: Docs, Metadata And Cleanup** — update architecture docs, source metadata and stale
  package references.
- [x] **Phase 5: Final Verification And Closeout** — run end-state searches, record evidence and
  close with verification evidence.

## Phase 0: Inventory And Boundary Freeze

**Goal:** confirm the exact blast radius before touching runtime code.

**Scope:**

- Inventory active references to:
  - `calendar-agent`
  - `academic_calendar`
  - `academic_calendar_lookup`
  - `packages/calendar-agent`
  - `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar`
- Decide if any external public contract requires accepting `calendar-agent` or
  `requested_capability=academic_calendar`.
- Freeze target owner:
  - runtime owner: `campus-services-agent`
  - tool: `academic_calendar_lookup`
  - data-plane owner: `calendar/academic_calendar`
- Produce migration checklist for code, fixtures, docs and tests.

**Exit Criteria:**

- Phase 0 summary names every file group to edit.
- Compatibility decision is explicit: no alias by default, unless concrete external dependency is
  found.
- Product gate decision is explicit: calendar opens through `campus_services`.

## Phase 1: Registry, Go Routing And Contract Reassignment

**Goal:** atomically make canonical registries, Go runtime policy/planner and internal execution
contracts express the new owner.

**Scope:**

- Update `configs/runtime/agents.v1.json`.
- Update `configs/runtime/tools.v1.json`.
- Update Go runtime policy capability inference, domain/task mapping and lane/opening gate handling.
- Update Go structured planner target/payload/tool mapping.
- Remove `calendar-agent` / standalone `academic_calendar` from internal execution contracts after
  Go no longer emits them.
- Regenerate Go/Python/TS execution contract artifacts.
- Update AgentSpec and ToolSpec registry tests.
- Update Go policy/planner/config/readyz/request tests.

**Exit Criteria:**

- AgentSpec has no active `calendar-agent`.
- ToolSpec assigns `academic_calendar_lookup` to `campus-services-agent`.
- Academic calendar examples plan as `campus-services-agent + academic_calendar_lookup`.
- Independent `academic_calendar` lane/opening gate is removed; old explicit capability and env
  values fail closed.
- Registry, contract and Go runtime tests prove the new target/tool mapping.

## Phase 2: Python Worker And Package Consolidation

**Goal:** make Python execution follow the new owner.

**Scope:**

- Remove `calendar-agent` from delegate map.
- Add `AcademicCalendarLookupPayload` handling to campus-services delegate/tool adapter.
- Reuse existing academic calendar internal query service client inside campus-services.
- Delete `packages/calendar-agent` after import audit.
- Remove `campus-calendar-agent` from workspace, worker dependency graph, Dockerfile and lockfile.
- Update Python dispatch and SDK runner tests.

**Exit Criteria:**

- Python dispatch rejects `target=calendar-agent`.
- Python dispatch accepts `target=campus-services-agent` with `academic_calendar_lookup`.
- SDK shell executes academic calendar via campus-services owner.
- `uv sync --all-packages --dev` succeeds without `campus-calendar-agent`.
- Docker/package tests no longer expect `packages/calendar-agent`.

## Phase 3: Eval, Smoke And Product Gate Rewrite

**Goal:** align tests and gates with the new target truth.

**Scope:**

- Update workflow trace fixtures.
- Update `agents_sdk_promotion_gate` expectations.
- Update public/chat and product-path samples.
- Add campus-services E2E calendar examples.
- Remove or merge standalone academic-calendar smoke profile.
- Keep data-plane smoke that verifies `calendar/academic_calendar`.

**Exit Criteria:**

- Eval traces expect `selected_target=campus-services-agent`.
- Product-path gate covers calendar under campus services.
- No eval fixture expects `calendar-agent`.

## Phase 4: Docs, Metadata And Cleanup

**Goal:** remove stale architecture truth and metadata owner drift.

**Scope:**

- Update:
  - `docs/architecture/current-architecture.md`
  - `docs/architecture/system/execution-and-agents-architecture.md`
  - `docs/architecture/domains/campus-services/architecture.md`
  - `docs/architecture/system/data-plane-architecture.md`
  - `docs/contracts/app-api-supervisor-execution.md`
  - deployment/readiness docs mentioning `academic_calendar` capability
- Update official-web source metadata owner values while keeping
  `selected_write_target=calendar/academic_calendar`.
- Remove stale package references after `packages/calendar-agent` deletion.

**Exit Criteria:**

- Docs no longer describe `calendar-agent` as current accepted runtime truth.
- Official-web metadata no longer names `calendar-agent` as runtime owner.
- `calendar/academic_calendar` data-plane ownership remains documented.

## Phase 5: Final Verification And Closeout

**Goal:** close with end-state evidence.

**Scope:**

- Run focused Go/Python/eval/docs verification lanes.
- Run end-state search for removed runtime names.
- Record verification evidence in `STATE.md`.
- Update `.planning/WORKSTREAMS.md` completion row.

**Exit Criteria:**

- No active runtime/code/test/package reference expects `calendar-agent`.
- No active runtime/code/test/package reference accepts standalone `academic_calendar` capability.
- Data-plane references to `calendar/academic_calendar` remain intact.
- Verification passes and closeout evidence is recorded in `STATE.md`.

## Verification Lanes

Expected focused verification:

```bash
cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/httpapi ./internal/execution ./internal/structuredquery
uv sync --all-packages --dev
uv run --all-packages python -m unittest tests.supervisor.agent_spec_registry_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agent_dispatch_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite -q
pnpm docs:lint
git diff --check
```
