---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 3
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: SDK Runner Shell And Fail-Close Mapping

## Goal

Add a safe SDK runner seam before opening any real SDK-backed pilot. The seam must consume
repo-owned `AgentRequest` and return repo-owned `AgentResponse` only.

## Implementation Scope

- Add an injectable runner shell in `apps/supervisor-agent-worker`.
- Build the runner request from:
  - `AgentRequest`
  - Go-projected target and `allowed_tools`
  - Phase 2 ToolSpec-derived tool descriptors
  - user goal, request id, and bounded context
- Add repo-owned runner DTOs for:
  - run request
  - run result
  - tool call summary
- Validate runner results before creating `AgentResponse`.
- Map fail-close cases into structured `AgentResponse` errors:
  - disabled runtime
  - ToolSpec bridge rejection
  - no tool call
  - multiple tool calls
  - wrong tool
  - invalid arguments
  - malformed final output
  - timeout
  - malformed runner result
  - generic runner exception
- Add sanitized success/error observability projections.

## Non-Scope

- No SDK `Runner.run`.
- No SDK `Agent` construction.
- No hosted MCP, web search, file search, code execution, filesystem, shell, raw SQL, object
  store, collector, ingestion, or index-build exposure.
- No real tool execution loop.
- No product-path opening.
- No `packages/contracts` changes.

## Acceptance Criteria

- Runner shell is default-closed behind an explicit `enabled` flag.
- Runner receives only repo-owned request data and ToolSpec-derived descriptors.
- Any tool call outside Go `allowed_tools` fails closed.
- Invalid arguments fail closed before a successful `AgentResponse` is produced.
- Timeout and runner failures become retryable structured errors where appropriate.
- Raw SDK response, run state, and trace are not serialized into contracts, panel, eval, or
  observability projections.

## Completion Notes

- Added `agents_sdk_runner.py` with `AgentsSdkRunRequest`, `AgentsSdkRunResult`,
  `AgentsSdkToolCall`, `AgentsSdkRunner`, and `run_agents_sdk_runner_shell`.
- Added schema-aware argument validation plus payload-class validation for admitted tool calls.
- Added `agents_sdk_runner_projection` and `agents_sdk_runner_error` safe-details projections.
- Added source-level guard ensuring Phase 3 still does not import SDK runtime or forbidden tool
  surfaces.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runner_suite -q
uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_runner tests.supervisor.test_agents_sdk_tool_bridge tests.supervisor.test_agents_sdk_runtime_policy tests.supervisor.provider_tool_runtime_suite tests.supervisor.provider_function_calling_suite tests.supervisor.tool_spec_registry_suite tests.contracts.contract_boundary_guardrails_suite -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py
uv run --all-packages ruff format apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py --check
pnpm docs:lint
git diff --check
```
