---
doc_type: closeout
workstream: notice-agent-card-first-tool-boundary
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Closeout: Notice Agent Card-First Tool Boundary

## Final Runtime Posture

- `campus_notice_discover` is the notice family agent-facing discovery tool.
- `campus_notice_get` is demoted to an internal selected notice resolve/context function.
- `campus_notice_get` is removed from agent-facing allowed tool names.
- ToolSpec marks `campus_notice_get` as `agent_internal`, function schema unavailable and runtime posture `closed`.
- Provider function schema snapshots exclude `campus_notice_get`.
- Provider tool runtime and Agents SDK notice-get pilot are closed and fail-closed on stale config.
- Notice-agent selected ref output is title/source URL/summary first and never concatenates `normalized_body`.
- Multi-step notice -> RAG bridge context labels bounded excerpt as summary and keeps workflow trace payload-free.
- Go finalizer no longer infers `campus_notice_get` as `selected_tool` from a single-notice
  `notice_id` result.
- Workflow trace evals allow internal selected notice resolve without agent-facing
  `selected_tools`, while preserving `payload_kind=campus_notice_get` as internal provenance.

## Completed Phases

- Phase 0: boundary inventory recorded.
- Phase 1: contracts and ToolSpec recut.
- Phase 2: Go runtime/finalizer guard recut.
- Phase 3: Python notice-agent/provider/SDK recut.
- Phase 4: eval denominator and drift guards updated.
- Phase 5: downstream bounded projection wording and tests updated.
- Phase 6: runtime contract, opening review and closeout artifacts updated.

## Verification Evidence

Focused verification run during closeout:

- `uv run --all-packages python -m unittest tests.agent.test_notice_agent -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_provider_function_calling -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_provider_tool_runtime -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_notice_get_pilot -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_runner -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_tool_bridge -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_trace_projection -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_runtime_policy -q`
- `uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_closeout_guardrails -q`
- `uv run --all-packages python -m unittest tests.evals.test_tool_family_denominator tests.evals.test_provider_tool_call_cases tests.evals.tool_routing_product_path_suite tests.supervisor.test_tool_function_schema tests.supervisor.test_agents_sdk_closeout_guardrails -q`
- `cd apps/supervisor-api && go test ./internal/execution ./internal/structuredplanning ./internal/httpapi`
- `uv run --all-packages python -m unittest tests.agent.test_notice_agent tests.supervisor.test_provider_function_calling tests.supervisor.test_provider_tool_runtime tests.supervisor.test_agents_sdk_notice_get_pilot tests.supervisor.test_agents_sdk_runner tests.supervisor.test_agents_sdk_tool_bridge tests.supervisor.test_agents_sdk_trace_projection tests.supervisor.test_agents_sdk_runtime_policy tests.supervisor.test_agents_sdk_closeout_guardrails tests.contracts.contract_models_services_and_notice_suite tests.api.supervisor_api_settings_and_health_suite tests.evals.intent_synthetic_suite tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.evals.agents_sdk_posture_decision_suite tests.evals.agents_sdk_pilot_parity_suite tests.evals.provider_tool_call_cases_suite tests.evals.tool_family_denominator_suite -q`
- `cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution ./internal/structuredplanning ./internal/structuredquery ./internal/runtimepolicy`

Full final gates are tracked in the implementation session final report.

## Known Defers

- Product notice serving remains gate-closed.
- Summary/fact extraction needs downstream target-specific admission before broad user exposure.
- Restricted notice body/context serving remains closed without entitlement projection.
- Provider-native and SDK native notice-get loops stay closed until a new non-body denominator is explicitly planned.

## Reopen Rule

Reopen this workstream only if:

- a notice body-serving path reappears in public answer, workflow trace, panel, eval asset or provider/SDK output,
- `campus_notice_get` or another body/context function re-enters top-level ToolSpec/provider schema,
- SDK/provider runtime bypasses Go allowed-tools or ToolSpec derivation,
- restricted notice body/context is exposed without authorization projection,
- downstream materialization starts passing raw notice body as cross-agent prompt context.
