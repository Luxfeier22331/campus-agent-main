---
doc_type: state
workstream: agents-sdk-domain-agent-adapter-promotion
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# State: Agents SDK Domain-Agent Adapter Promotion

## Current Position

**Status:** Completed, explicit-gated candidate evidence complete
**Current Phase:** Closed
**Last Activity:** 2026-05-04
**Last Activity Description:** Added and ran a dedicated structured-query E2E smoke for
`notice-agent + campus_notice_discover`: real OpenAI Agents SDK/provider, Python worker bridge,
repo-owned tool executor, Go `supervisor-api` internal query route, and temporary PG
`internal_notice_read_model`.

## Baseline Facts

- `openai-agents>=0.14.8` is already a worker dependency.
- `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED` defaults off.
- `_build_agents_sdk_runner` is target-agnostic and only builds the OpenAI Agents SDK runner after
  explicit runtime gate, selected target/tool allowlist, provider, model and API key are configured.
- `campus_notice_get` is `agent_internal` with `runtime_posture=closed`.
- `campus_notice_discover` is the first live read-only agent-facing notice ToolSpec candidate with
  `runtime_posture=sdk_adapter_candidate`.
- Go `supervisor-api` remains AgentSpec / ToolSpec / WorkflowPlan / finalizer owner.

## Remaining Follow-Up

- No code blocker for explicit-gated candidate.
- Default-on promotion remains deferred until broader latency/cost/error evidence supports a
  separate posture decision.

## Next Step

Do not reopen this workstream for normal explicit-gated use. Reopen only if default-on promotion,
SDK target/tool expansion, SDK runner semantic drift or trace/contract leakage needs a new posture
decision.

## Verification

Current targeted verification:

```bash
uv run --all-packages python -m scripts.agents_sdk_notice_discover_smoke
uv run --all-packages python -m scripts.agents_sdk_notice_discover_e2e_smoke --timeout-seconds 90 --startup-timeout-seconds 180
uv run --all-packages python -m unittest tests.test_supervisor_runtime_process_smoke tests.test_agents_sdk_notice_discover_e2e_smoke tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.agents_sdk_notice_get_pilot_suite tests.evals.agents_sdk_promotion_gate_suite -q
go test ./internal/runtimepolicy ./internal/httpapi ./internal/config
pnpm docs:lint
git diff --check -- .planning/workstreams/agents-sdk-domain-agent-adapter-promotion apps/supervisor-agent-worker/src/campus_supervisor_agent_worker apps/supervisor-api/internal/runtimepolicy configs/runtime/tools.v1.json packages/evals/src/campus_evals tests/supervisor tests/evals docs/contracts/campus-notice-runtime-contract.md docs/architecture/system/execution-and-agents-architecture.md
```

Fresh smoke evidence, 2026-05-04:

- `uv run --all-packages python -m scripts.agents_sdk_notice_discover_smoke`
- `passed=true`
- `mode=real_openai_agents_sdk_with_fixture_notice_query_service`
- `elapsed_ms=11813`
- `selected_tool=campus_notice_discover`
- `tool_outcome=sdk_completed`
- `tool_call_count=1`
- `tool_execution_count=1`
- `runtime_posture=sdk_adapter_candidate`
- `internal_query_base_url_present=false`
- `internal_query_secret_present=false`

This proves the real OpenAI Agents SDK/provider adapter lane executes the selected repo-owned tool
shell. It does not prove `SDK -> notice-agent -> Go structured-query -> PG/read-model` E2E.

Structured-query E2E smoke evidence, 2026-05-04:

- `uv run --all-packages python -m scripts.agents_sdk_notice_discover_e2e_smoke --timeout-seconds 90 --startup-timeout-seconds 180`
- `passed=true`
- `mode=real_openai_agents_sdk_with_go_structured_query_pg_read_model`
- `structured_query_e2e=true`
- `worker_readyz_status=200`
- `api_readyz_status=200`
- `tool_call_count=1`
- `tool_execution_count=1`
- `source_ref_count=1`
- seed title returned: `烟雾测试通知`
- seed source URL returned: `https://example.invalid/notices/smoke`
- `old_internal_query_env_absent=true`

This proves `SDK -> notice-agent -> Go structured-query -> temporary PG internal_notice_read_model`
for the selected explicit-gated candidate.

## Continuity Notes

- This workstream is about SDK adapter promotion, not repo-wide supervisor replacement.
- It must preserve `supervisor-multi-agent-runtime-contract-hardening` boundaries.
- It must not interfere with active `agentic-rag-runtime-rearchitecture`.
- Default-on runtime promotion is not allowed before Phase 6-8 evidence.
