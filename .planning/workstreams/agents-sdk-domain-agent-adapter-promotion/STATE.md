---
doc_type: state
workstream: agents-sdk-domain-agent-adapter-promotion
status: completed
created: 2026-05-04
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# State: Agents SDK Domain-Agent Adapter Promotion

## Current Position

**Status:** Completed, default-on domain-agent adapter admitted
**Current Phase:** Closed
**Last Activity:** 2026-05-05
**Last Activity Description:** Promoted Agents SDK to the default worker-side domain-agent adapter
for ToolSpec-admitted tools, expanded admission to notice discover / all campus-services
read-only structured tools / academic calendar, cleared stale Go direct-runtime process smoke and
workflow eval cases, and added deterministic mock SDK process-smoke support for local public/chat
style validation without fake provider keys.

## Baseline Facts

- `openai-agents>=0.14.8` is already a worker dependency.
- `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED` defaults on and can be set to `false` as the kill switch.
- `_build_agents_sdk_runner` is target-agnostic and only builds the OpenAI Agents SDK runner after
  runtime gate, provider, model and API key are configured.
- `campus_notice_get` is `agent_internal` with `runtime_posture=closed`.
- `campus_notice_discover`、`service_status_lookup`、`service_guide_lookup`、
  `transport_schedule_lookup`、`contact_directory_lookup` and `academic_calendar_lookup` are
  live read-only agent-facing ToolSpec SDK adapters with
  `runtime_posture=sdk_adapter_admitted`.
- Public `/api/v1/answer` and `/api/v1/answer/stream` skip Go direct structured execution for
  SDK-admitted structured handoffs and run them through the bridge-backed `single_handoff` lane.
- Local process smoke profiles for opened read-only structured tools use SDK profile names
  (`*_sdk_opened`) and assert `single_handoff` / `sdk_completed`; public `notice_get` direct smoke
  is no longer part of the opened profile denominator.
- SDK target/tool eligibility is derived from AgentSpec, ToolSpec and Go
  `AgentRequest.allowed_tools`; worker env no longer carries a target/tool allowlist.
- Go `supervisor-api` remains AgentSpec / ToolSpec / WorkflowPlan / finalizer owner.

## Remaining Follow-Up

- Public/chat dev E2E now has local pass evidence. Staging/production public/chat E2E remains a
  release/backlog smoke.
- Latency/cost/error evidence should continue through observability and eval gates after deployment
  traffic exists.

## Next Step

Do not reopen this workstream for ordinary SDK adapter use. Reopen only if broad multi-agent
orchestration ownership, SDK target/tool expansion beyond current ToolSpec admission, SDK runner
semantic drift or trace/contract leakage needs a new posture decision.

## Verification

Current targeted verification:

```bash
uv run --all-packages python -m scripts.agents_sdk_notice_discover_smoke
uv run --all-packages python -m scripts.agents_sdk_notice_discover_e2e_smoke --timeout-seconds 90 --startup-timeout-seconds 180
uv run --all-packages python -m unittest tests.test_supervisor_runtime_process_smoke tests.test_agents_sdk_notice_discover_e2e_smoke tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.agents_sdk_notice_get_pilot_suite tests.supervisor.agents_sdk_closeout_guardrails_suite tests.api.supervisor_api_settings_and_health_suite tests.evals.agents_sdk_promotion_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.evals.workflow_trace_gate_suite -q
go test ./internal/runtimepolicy ./internal/config ./internal/httpapi
pnpm docs:lint
git diff --check -- .planning/workstreams/agents-sdk-domain-agent-adapter-promotion apps/supervisor-agent-worker/src/campus_supervisor_agent_worker apps/supervisor-api/internal/runtimepolicy apps/supervisor-api/internal/httpapi configs/runtime/tools.v1.json packages/evals/src/campus_evals packages/evals/fixtures/workflow_trace_gate_cases.v1.json scripts tests/supervisor tests/evals tests/test_supervisor_runtime_process_smoke.py docs/contracts docs/architecture/system/execution-and-agents-architecture.md
```

Fresh targeted unit/eval evidence, 2026-05-05:

- `uv run --all-packages python -m unittest tests.test_supervisor_runtime_process_smoke tests.supervisor.agents_sdk_notice_get_pilot_suite -q`
- `Ran 29 tests`
- `OK`
- `uv run --all-packages python -m unittest tests.evals.agents_sdk_promotion_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.evals.workflow_trace_gate_suite -q`
- `Ran 40 tests`
- `OK`

Fresh targeted unit evidence, 2026-05-05:

- `uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.agents_sdk_notice_get_pilot_suite tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agents_sdk_closeout_guardrails_suite tests.api.supervisor_api_settings_and_health_suite tests.evals.agents_sdk_promotion_gate_suite -q`
- `Ran 68 tests`
- `OK`

Fresh smoke evidence, 2026-05-04:

- `uv run --all-packages python -m scripts.agents_sdk_notice_discover_smoke`
- `passed=true`
- `mode=real_openai_agents_sdk_with_fixture_notice_query_service`
- `elapsed_ms=11813`
- `selected_tool=campus_notice_discover`
- `tool_outcome=sdk_completed`
- `tool_call_count=1`
- `tool_execution_count=1`
- `runtime_posture=sdk_adapter_admitted`
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
for the selected explicit-gated adapter.

Public chat dev E2E evidence, 2026-05-05:

- `pnpm --dir apps/app-api chat:e2e:dev`
- `passed=true`
- `resultKind=answer`
- `requestId=req_82d3d8b39a234498b952fd4fa9c98dab`
- `traceId=trace_127b594fde35463fa80e85ffc15d99cd`
- exercised local `public-chat-web` auth/session flow and Docker-first
  `supervisor-api -> supervisor-agent-worker -> rag-agent`
- fixed blockers:
  - supervisor-api runtime image now ships `/etc/campus-agent/agents.v1.json` and sets
    `SUPERVISOR_API_AGENT_SPEC_PATH`
  - terminal supervisor responses include canonical nullable `result` and `error`
  - local dev chat E2E sign-in sends the Turnstile test captcha token when the configured secret is
    Cloudflare's test secret

## Continuity Notes

- This workstream is about SDK adapter promotion, not repo-wide supervisor replacement.
- It must preserve `supervisor-multi-agent-runtime-contract-hardening` boundaries.
- It must not interfere with active `agentic-rag-runtime-rearchitecture`.
- Future tool expansion beyond the admitted ToolSpec set requires reopening the target/tool matrix.
