---
doc_type: state
status: completed
created: 2026-05-06
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# State: Academic Calendar Campus Services Consolidation

## Current Slice

Completed.

## Current Phase

Phase 5 completed: final verification and closeout.

## Immediate Next Action

None for this workstream.

## Phase 0 Evidence

- Reference inventory:
  `./phases/phase-0-inventory-and-boundary-freeze/REFERENCE-INVENTORY.md`
- Boundary decision:
  `./phases/phase-0-inventory-and-boundary-freeze/BOUNDARY-DECISION.md`
- Compatibility decision:
  `./phases/phase-0-inventory-and-boundary-freeze/COMPATIBILITY-DECISION.md`
- Implementation checklist:
  `./phases/phase-0-inventory-and-boundary-freeze/IMPLEMENTATION-CHECKLIST.md`

## Frozen Decisions

- Runtime owner: `campus-services-agent`.
- Tool: `academic_calendar_lookup`.
- Data-plane owner: `calendar/academic_calendar`.
- No compatibility alias for `calendar-agent`.
- No compatibility alias for `requested_capability=academic_calendar`.
- No compatibility alias for `SUPERVISOR_API_OPEN_CAPABILITIES=academic_calendar`.

## Implementation Result

- `configs/runtime/agents.v1.json` no longer has active `calendar-agent`.
- `configs/runtime/tools.v1.json` assigns `academic_calendar_lookup` to
  `campus-services-agent` under `campus_services`.
- Go runtime policy, planner, request admission, config and readyz no longer use an independent
  `academic_calendar` runtime capability.
- Internal execution contracts no longer admit `calendar-agent` or requested capability
  `academic_calendar`.
- Python worker routes `academic_calendar_lookup` through the campus-services delegate and SDK
  tool execution path.
- `packages/calendar-agent` and the `campus-calendar-agent` workspace dependency are removed.
- Eval, smoke, product-path fixtures and official-web metadata now expect
  `campus-services-agent` while preserving `calendar/academic_calendar` data-plane truth.
- Current architecture, execution/agents, campus-services, contract and deploy readiness docs are
  updated to describe academic calendar as a campus-services runtime tool.

## Blockers

None for this workstream.

Repo-wide `pnpm docs:lint` currently still reports one unrelated pre-existing MD013 line in
`docs/architecture/system/retrieval-serving-architecture.md:68`, which this workstream did not
modify.

Repo-wide `pnpm decomposition:lint` remains blocked by existing and parallel-workstream oversized
files. This closeout already moved the academic-calendar SDK delegate regression out of the
oversized notice pilot suite; `tests/supervisor/agents_sdk_notice_get_pilot_suite.py` is now
799 lines. The core changed files for this runtime ownership migration are also under threshold:
`agent_delegates.py` is 760 lines, `campus_services_agent/tool_adapter.py` is 724 lines, and
`campus_services_academic_calendar_suite.py` is 194 lines. Some touched historical fixture/golden
test files are still over threshold and should be handled by the repo-wide decomposition
workstream, not by expanding this runtime consolidation scope.

## Verification Evidence

Fresh evidence from 2026-05-07:

- `cd apps/supervisor-api && go test -count=1 ./internal/runtimepolicy ./internal/structuredplanning ./internal/config ./internal/execution ./internal/httpapi ./internal/structuredquery`
  passed.
- `uv run --all-packages python -m unittest tests.supervisor.agent_spec_registry_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agent_dispatch_suite tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.agents_sdk_notice_get_pilot_suite tests.agent.campus_services_academic_calendar_suite tests.contracts.contract_models_services_and_notice_suite tests.contracts.canonical_supervisor_execution_schema_suite tests.evals.agents_sdk_promotion_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.test_supervisor_runtime_process_smoke tests.test_supervisor_api_local_runtime tests.test_check_dockerfile_tracked -q`
  passed: `Ran 158 tests ... OK`.
- Focused Ruff check passed for the touched worker, campus-services, supervisor test, API test and
  smoke script files.
- Focused Ruff format check passed for the touched worker, campus-services, supervisor test, API
  test and smoke script files.
- `pnpm --filter official-web-core test -- source-pack.test.ts config.test.ts` passed:
  `5 passed`, `36 passed`.
- `pnpm --filter official-web-collector test -- source-pack-plan.test.ts consumer-denominator.test.ts`
  passed: `17 passed`, `136 passed`.
- Focused markdownlint passed for this workstream's changed docs and planning docs.
- `git diff --check` passed.
- `pnpm decomposition:lint` was attempted and still fails on repo-wide oversized files. This
  workstream removed its academic-calendar SDK regression from the oversized notice pilot suite,
  but did not take over broad decomposition of existing official-web, smoke, eval or Go golden
  fixture files.
- End-state searches found `calendar-agent` only in negative assertion tests; no active runtime,
  metadata owner, package, dependency or selected-target reference remains.

## Review Fixes Applied

- Phase 1 now groups registry, Go runtime/planner and contract enum migration atomically so it can
  pass as an independent slice.
- `academic_calendar` env/opening gate removal now requires explicit config/readyz/request tests.
- Python package consolidation now requires workspace sync and Docker/package verification.
- Phase 0 verification command now includes all generated Phase 0 evidence documents.

## Continuity Notes

This workstream is a runtime ownership consolidation. It must not rename `calendar/academic_calendar`
source truth or turn academic calendar into generic RAG.
