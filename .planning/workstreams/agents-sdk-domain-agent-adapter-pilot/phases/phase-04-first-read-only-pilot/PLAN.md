---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 04-first-read-only-pilot
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 4: First Read-Only Pilot

## Goal

Open the first explicit-gate Agents SDK-backed read-only domain-agent pilot for
`notice-agent` + `campus_notice_get`, while keeping Go-owned `allowed_tools`,
repo-owned ToolSpec descriptors, existing notice-agent query execution, and
`AgentResponse` as the only shared contract surface.

## Scope

- Extend the Phase 3 runner shell with an optional repo-owned tool executor.
- Require actual tool execution for the pilot lane; fail closed if the SDK runner only
  reports a tool call without executing the repo-owned tool.
- Validate tool name, argument schema, payload class, call id, and executed-vs-reported
  argument values.
- Add a `campus_notice_get` SDK pilot adapter that delegates tool execution to the existing
  notice-agent query path.
- Add a real OpenAI Agents SDK runner wrapper behind the existing default-off SDK runtime gate.
- Route `notice-agent + campus_notice_get` to the SDK pilot only when SDK target/tool gates match
  exactly; otherwise preserve the existing default/provider/native notice-agent paths.

## Non-Goals

- No SDK-native types in `packages/contracts`.
- No hosted MCP, web search, file search, object store, collector, ingestion, index build, shell,
  filesystem, raw SQL, or state-changing tool surface.
- No replacement of Go `supervisor-api` admission, routing, finalization, or workflow ownership.
- No opening of `campus_notice_discover` or other tools.

## Implementation Notes

- Added `AgentsSdkToolExecutionRequest` and `AgentsSdkToolExecutor` to the private runner shell.
- Added execution recording and bounded `tool_result_projection` under
  `agents_sdk_runner_projection`.
- Added fail-close reasons:
  - `sdk_tool_not_executed`
  - `sdk_tool_execution_failed`
  - `sdk_multiple_tool_executions`
  - `sdk_tool_execution_mismatch`
- Added `agents_sdk_notice_get_pilot.py` for the bounded pilot adapter.
- Added `agents_sdk_openai_runner.py` for the isolated OpenAI Agents SDK wrapper.
- Added shared `notice_tool_projection.py` so SDK and provider loop adapters use the same bounded
  notice result projection.
- Updated `agent_delegates.py` so the SDK pilot is preferred over provider tool runtime only when
  the SDK gate is explicitly admitted for exactly `notice-agent` and `campus_notice_get`.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_notice_get_pilot_suite -q
uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_notice_get_pilot tests.supervisor.test_agents_sdk_runner tests.supervisor.test_agents_sdk_tool_bridge tests.supervisor.test_agents_sdk_runtime_policy tests.supervisor.provider_tool_runtime_suite tests.supervisor.provider_function_calling_suite tests.supervisor.tool_spec_registry_suite tests.contracts.contract_boundary_guardrails_suite -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py
uv run --all-packages ruff format apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py --check
```
