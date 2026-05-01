---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 05-trace-projection-observability-parity
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 5: Trace Projection And Observability Parity

## Goal

Make the Phase 4 SDK pilot inspectable through repo-owned sanitized observability, without
serializing SDK-native run state, raw model output, raw trace payloads, or provider responses into
`AgentResponse`, workflow trace, panel, or eval artifacts.

Official design input: OpenAI documents the SDK run loop as an application-level turn that may
perform model calls, tool calls, handoffs, and final output. It also documents SDK tracing as a
debug/eval input for model calls, tool calls, handoffs, guardrails, and custom spans. In this repo,
those surfaces remain internal adapter evidence; only repo-owned projections may cross boundaries.

## Boundary Decisions

- SDK raw trace is debug input only.
- `AgentObservability.safe_details` may carry sanitized projection dictionaries, not SDK objects.
- `model_response_ref` / trace refs are correlation metadata only; they do not replace repo-owned
  request ids, tool call ids, workflow step ids, or source ids.
- Phase 5 does not enable hosted MCP, local MCP, web search, file search, shell, filesystem,
  object store, collector, ingestion, index build, raw SQL, or state-changing tools.
- Phase 5 does not change `packages/contracts`; it uses existing `safe_details` dictionaries and
  tests guard against SDK type leakage.

## Implementation Plan

1. Add tests first in `tests/supervisor/agents_sdk_trace_projection_suite.py`.
   - success projection includes schema version, lane, target, selected tool, tool call count,
     tool execution count, argument keys, tool outcome, result outcome, and latency bucket.
   - fail-close projection includes failure class, retryable flag, tool attempted, and latency
     bucket.
   - source guard rejects raw trace keys such as `raw_response`, `raw_model_output`,
     `raw_responses`, `sdk_run_state`, `trace_url`, `provider_response`, and SDK object reprs.
   - parity guard checks SDK projection covers the same lifecycle concepts as
     `provider_tool_call_projection`.

2. Add a private projection helper in `apps/supervisor-agent-worker`.
   - Candidate module: `agents_sdk_trace_projection.py`.
   - Candidate schema versions:
     - `agents-sdk-trace-projection-v1`
     - `agents-sdk-tool-lifecycle-projection-v1`
   - Keep helper pure and easily unit-testable.

3. Extend `agents_sdk_runner.py`.
   - Capture start/end monotonic timestamps around the runner call.
   - Add sanitized `agents_sdk_trace_projection` to success and error responses.
   - Include only bounded scalar/list/map fields:
     - `adapter_lane`
     - `runtime_posture`
     - `target`
     - `selected_tool`
     - `tool_call_count`
     - `tool_execution_count`
     - `tool_argument_keys`
     - `tool_outcome`
     - `result_outcome`
     - `failure_class`
     - `retryable`
     - `latency_ms`
     - `model_response_ref`
   - Never include tool argument values beyond existing bounded argument summaries.

4. Extend `agents_sdk_notice_get_pilot.py`.
   - Preserve notice-agent source/result observability.
   - Merge SDK trace projection without overwriting notice-agent guardrails.
   - Ensure the pilot projection states that actual tool execution is repo-owned.

5. Add bridge-to-workflow-trace tests where practical.
   - If the current workflow trace summary only consumes Go-side fields, keep Python projection
     under `AgentObservability.safe_details`.
   - If a Go bridge consumer already maps agent safe details, add a narrow fixture that proves SDK
     projection can be copied only as sanitized `tool_call_summaries` / diagnostics.

## Acceptance Criteria

- SDK pilot responses include sanitized SDK run/tool lifecycle projections on success and
  fail-close.
- Provider tool runtime and SDK pilot expose comparable lifecycle facts for Phase 6 parity.
- No SDK raw response, run state, trace URL, hosted tool payload, or SDK object leaks into
  contracts, panel, eval canonical fixture, or workflow trace summary.
- Default-off product behavior remains unchanged.

## Completion Notes

- Added repo-owned `agents_sdk_trace_projection` and `agents_sdk_tool_lifecycle_projection`
  dictionaries under `AgentObservability.safe_details`.
- Success projection now records adapter lane, ToolSpec runtime posture, selected tool, call /
  execution counts, argument key names only, outcomes, retryability, latency, and
  `model_response_ref`.
- Fail-close projection now records failure class, retryability, tool attempted state, latency, and
  bounded execution count without raw SDK state.
- Tool result projection now omits raw SDK/provider trace keys and unsafe SDK object-like values.
- Added Phase 5 tests covering success, fail-close, notice-get pilot merge preservation,
  raw-surface omission, and provider lifecycle parity.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_trace_projection_suite -q
uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_notice_get_pilot tests.supervisor.test_agents_sdk_runner tests.supervisor.provider_tool_runtime_suite tests.contracts.contract_boundary_guardrails_suite -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py
uv run --all-packages ruff format apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py --check
pnpm docs:lint
git diff --check
```

## External References

- OpenAI Agents SDK running agents:
  `https://developers.openai.com/api/docs/guides/agents/running-agents#the-agent-loop`
- OpenAI Agents SDK integrations and observability:
  `https://developers.openai.com/api/docs/guides/agents/integrations-observability`
