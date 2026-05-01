---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 06-eval-denominator-parity-harness
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 6: Eval Denominator And Parity Harness

## Goal

Compare the SDK `notice-agent + campus_notice_get` pilot against the existing custom provider
function-call loop using shared, repeatable fixtures. The output is runtime decision evidence, not
product opening truth.

Official design input: OpenAI recommends using traces first while debugging agent behavior, then
moving to repeatable datasets and eval runs once the definition of good behavior is stable. Phase 6
follows that sequence after Phase 5 establishes sanitized projections.

## Boundary Decisions

- Phase 6 uses deterministic fake runners/providers for most tests; it must not require live OpenAI
  network calls.
- Live provider checks, if added later, must be explicit integration lane and default-off.
- Parity compares repo-owned observations:
  - selected tool
  - argument keys / argument summary
  - tool execution status
  - failure class
  - final answer presence
  - bounded result projection usage
- Parity does not compare SDK raw trace, raw model text, token-level output, or proprietary run
  internals.
- A passing Phase 6 does not by itself promote SDK to default runtime.

## Implementation Plan

1. Add a focused fixture.
   - Candidate path: `packages/evals/fixtures/agents_sdk_notice_get_parity.v1.json`.
   - Include cases:
     - `notice_get_should_call_minimal_args`
     - `notice_get_should_call_with_source_family`
     - `notice_get_wrong_tool_fail_close`
     - `notice_get_no_tool_call_fail_close`
     - `notice_get_bad_arguments_fail_close`
     - `notice_get_query_service_failure_retryable`
     - `notice_get_final_answer_uses_tool_result`
     - `notice_get_executed_reported_argument_drift_fail_close`

2. Add a parity evaluator.
   - Candidate module: `packages/evals/src/campus_evals/agents_sdk_pilot_parity.py`.
   - Inputs:
     - parity fixture cases
     - SDK lane observation
     - provider lane observation
   - Output:
     - `AgentsSdkPilotParityReport`
     - per-case result with `passed`, `failure_class`, `sdk_observation`, `provider_observation`
   - Keep dataclasses simple and JSON-serializable.

3. Add deterministic harness tests.
   - Candidate test: `tests/evals/agents_sdk_pilot_parity_suite.py`.
   - Use fake SDK runner and fake provider function-call provider.
   - Use fake notice query service shared by both lanes.
   - Assert parity for success and fail-close cases.

4. Add supervisor adapter observation extraction.
   - Add helper that converts an `AgentResponse` into a parity observation using only sanitized
     safe details and top-level observability.
   - Candidate fields:
     - `lane`
     - `status`
     - `selected_tool`
     - `tool_attempted`
     - `tool_outcome`
     - `failure_class`
     - `argument_keys`
     - `source_ref_count`
     - `result_outcome`

5. Register eval exports only if local package style requires it.
   - Update `packages/evals/src/campus_evals/__init__.py` if existing eval modules are exported.
   - Do not alter public app-api or product serving path.

6. Document parity evidence shape.
   - Add notes to this phase plan after implementation.
   - Optionally add a short reference doc only if the harness becomes reusable outside this
     workstream.

## Acceptance Criteria

- SDK lane and provider lane can be run against the same `campus_notice_get` denominator cases.
- Success and fail-close cases produce comparable repo-owned observations.
- The harness detects wrong tool, no tool, bad args, query-service failure, and
  executed-vs-reported argument drift.
- No live provider call is required for unit tests.
- No raw SDK/provider payload is stored in eval canonical fixtures.

## Completion Notes

- Added `packages/evals/fixtures/agents_sdk_notice_get_parity.v1.json` with eight
  `campus_notice_get` denominator cases covering success, source-family precision, wrong tool,
  missing tool call, bad arguments, query-service failure, final-answer result usage, and
  SDK executed-vs-reported argument drift.
- Added `campus_evals.agents_sdk_pilot_parity` with JSON fixture loading, lane-specific
  expectations, sanitized `AgentResponse` observation extraction, normalized failure-kind mapping,
  and per-case parity reports.
- Extended provider tool-call projection with bounded `argument_keys` and `tool_execution_count`
  so the provider lane can be compared with SDK trace/lifecycle projections without raw payloads.
- Added deterministic tests that run both lanes through fake SDK runner/provider/query service and
  verify the harness detects the required fail-close modes without live OpenAI calls.
- Exported the parity harness from `campus_evals` for the next runtime-posture decision phase.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.agents_sdk_pilot_parity_suite -q
uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_notice_get_pilot tests.supervisor.provider_tool_runtime_suite tests.evals.tool_family_denominator_suite tests.evals.workflow_trace_gate_suite -q
uv run --all-packages ruff check packages/evals/src tests/evals apps/supervisor-agent-worker/src tests/supervisor
uv run --all-packages ruff format packages/evals/src tests/evals apps/supervisor-agent-worker/src tests/supervisor --check
pnpm docs:lint
git diff --check
```

## External References

- OpenAI agent workflow evals:
  `https://developers.openai.com/api/docs/guides/agent-evals`
- OpenAI Agents SDK integrations and observability:
  `https://developers.openai.com/api/docs/guides/agents/integrations-observability`
