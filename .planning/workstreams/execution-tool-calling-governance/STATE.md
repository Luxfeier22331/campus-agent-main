---
doc_type: state
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# State: Execution Tool Calling Governance

## Current Status

- status: `completed`
- current phase: `Phase 14 completed`
- current slice: closeout and guardrails completed
- owner: none
- active implementation: no

## Last Activity

- 2026-05-01: created native workstream through `gsd-sdk`.
- 2026-05-01: recorded target architecture updates for repo-owned tool
  orchestration and provider-native function calling as domain-agent adapter.
- 2026-05-01: planned Phase 1-9 and created executable phase `PLAN.md` files.
- 2026-05-01: completed Phase 1 tool surface inventory and drift gap report.
- 2026-05-01: added ToolSpec registry, Go runtimepolicy integration, Python
  allowed-tools dispatch boundary, provider function schema generation,
  canonical tool-call lifecycle projection, eval denominator drift guard, and
  gated provider-native `campus_notice_get` runtime adapter.
- 2026-05-01: tightened closeout implementation by making Python dispatch
  consume ToolSpec directly, adding a Responses-style provider function-call
  adapter with injectable HTTP runtime support and `call_id` preservation, and
  adding provider tool-call eval cases.
- 2026-05-01: promoted the provider tool runtime out of experimental naming, added
  default-off env gate and readiness admission summary, and kept the pilot
  allowlist constrained to `campus_notice_get`.
- 2026-05-01: wired admitted `campus_notice_get` notice-agent delegates through
  the provider tool runtime, with other notice tool paths remaining on typed
  adapters.
- 2026-05-01: reopened closeout for Phase 10-14; hardened strict provider
  schemas, split ToolSpec `function_schema` from `runtime_posture`, implemented
  the gated provider tool loop with bounded `function_call_output`, converted
  provider runtime failures into structured `AgentResponse` fail-close, and
  projected provider call correlation into Go workflow traces.

## Current Decision

This workstream adopts application-owned tool orchestration:

`Go supervisor-api -> ToolSpec / allowed_tools -> domain-agent tool loop ->
thin adapter -> internal query service -> sanitized AgentResponse -> Go
finalization`

Provider-native function calling is a domain-agent implementation substrate. It
does not own repo-level routing, admission, source trust, observability, eval or
fail-close semantics.

## Open Questions

- None for the completed implementation slice.

## Blockers

- None.

## Latest Verification

- `cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/httpapi`: pass
- `uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite tests.supervisor.agent_handoff_suite tests.api.supervisor_api_bridge_handoff_suite tests.api.supervisor_api_settings_and_health_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.tool_function_schema_suite tests.supervisor.provider_function_calling_suite tests.supervisor.provider_tool_runtime_suite tests.evals.tool_family_denominator_suite tests.evals.provider_tool_call_cases_suite`: pass
  (55 tests)
- `uv run --all-packages python -m unittest tests.supervisor.tool_function_schema_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.provider_function_calling_suite tests.supervisor.provider_tool_runtime_suite tests.api.supervisor_api_settings_and_health_suite`: pass
  (32 tests)
- `cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/httpapi`: pass
- `uv run --all-packages python -m campus_supervisor_agent_worker.tool_function_schema --check`: pass
- `uv run --all-packages ruff check apps/supervisor-agent-worker/src/campus_supervisor_agent_worker packages/evals/src/campus_evals tests/supervisor tests/api tests/evals`: pass
- `uv run --all-packages ruff format apps/supervisor-agent-worker/src/campus_supervisor_agent_worker packages/evals/src/campus_evals tests/supervisor tests/api tests/evals --check`: pass
- `pnpm exec markdownlint-cli2
  '.planning/workstreams/execution-tool-calling-governance/**/*.md'
  docs/architecture/system/execution-and-agents-architecture.md`: pass
- `pnpm docs:lint`: pass
- `pnpm yaml:lint`: pass
- `git diff --check`: pass
- `uv run --all-packages ruff check .`: blocked by unrelated import sorting in
  `tests/ingestion/test_index_release_acceptance.py`
- `pnpm decomposition:lint`: blocked by unrelated existing decomposition
  violations outside this workstream, including authenticated-notice collector,
  ingestion-worker and ingestion-core files.

## Continuity Notes

- Provider-native function calling remains gated and domain-agent scoped.
- Do not expand public product capability opening in this workstream.
- Keep `packages/contracts` provider-agnostic; provider function schema generation
  must remain an adapter artifact, not a contract type leak.
- Reopen only if a new tool is added without ToolSpec/eval/schema coverage,
  provider-native function calling is moved out of a gated domain-agent adapter,
  or Go `allowed_tools` stops deriving from `configs/runtime/tools.v1.json`.
