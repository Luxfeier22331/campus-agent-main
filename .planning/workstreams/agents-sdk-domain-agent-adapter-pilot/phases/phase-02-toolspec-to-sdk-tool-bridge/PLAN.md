---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 2
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: ToolSpec To SDK Tool Bridge

## Goal

Make the OpenAI Agents SDK tool surface subordinate to repo-owned `ToolSpec` and Go
`allowed_tools` before any SDK runner, SDK agent, or product-path execution is introduced.

## Implementation Scope

- Add a Python worker bridge module that builds repo-owned SDK tool descriptors from:
  - `configs/runtime/tools.v1.json`
  - generated provider function schema
  - Go-projected `allowed_tools`
- Preserve deterministic runtime policy metadata in the descriptor:
  - read-only posture
  - timeout seconds
  - maximum result bytes
  - bounded result projection kind
  - stable fail-close reason
- Fail closed for:
  - missing `allowed_tools`
  - unknown tool names
  - duplicate allowed tool names
  - inactive tools
  - non-`structured_handoff` surfaces
  - non-read-only tools
  - unavailable or non-strict function schemas
  - tools whose runtime posture has not been admitted for provider-style execution
- Add a drift guard proving the bridge cannot define a new canonical tool surface and does not
  import or execute SDK runtime facilities.

## Non-Scope

- No SDK `Runner.run`.
- No SDK `Agent` construction.
- No hosted MCP, web search, file search, code execution, filesystem, shell, raw SQL, object
  store, collector, ingestion, or index-build tool exposure.
- No Go planner changes.
- No `packages/contracts` changes.
- No product-path opening.

## Acceptance Criteria

- `campus_notice_get` can be projected into a descriptor from ToolSpec and generated provider
  schema.
- Typed handoff-only tools such as `service_status_lookup` are rejected before the SDK surface.
- Agent-internal tools such as `retrieval.query` are rejected.
- The bridge exposes only Go `allowed_tools` and fails closed for hallucinated tool names.
- Bridge source contains no SDK runtime execution or forbidden hosted/raw infrastructure surfaces.

## Completion Notes

- Added `agents_sdk_tool_bridge.py` with `AgentsSdkToolDescriptor`,
  `AgentsSdkToolBridgeError`, and `build_agents_sdk_tool_descriptors`.
- Added `provider_function_schema_for_tool()` so provider schema generation remains single-source
  and can be reused by the bridge without duplicating payload schema logic.
- Added focused tests for descriptor projection, stable fail-close reasons, typed-handoff
  rejection, agent-internal rejection, and source-level runtime leak guard.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_tool_bridge_suite -q
uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_tool_bridge tests.supervisor.test_agents_sdk_runtime_policy tests.supervisor.tool_spec_registry_suite tests.supervisor.provider_function_calling_suite tests.contracts.contract_boundary_guardrails_suite -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py
uv run --all-packages ruff format apps/supervisor-agent-worker/src tests/supervisor tests/contracts/contract_boundary_guardrails_suite.py --check
pnpm docs:lint
git diff --check
```
