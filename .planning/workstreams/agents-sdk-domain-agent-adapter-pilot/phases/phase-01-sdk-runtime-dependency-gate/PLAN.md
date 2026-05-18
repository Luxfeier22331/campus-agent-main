---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 1
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: SDK Runtime Dependency And Admission Gate

## Goal

Introduce the OpenAI Agents SDK dependency and runtime admission posture in
`apps/supervisor-agent-worker` without executing SDK-backed agent runs or changing default
behavior.

## Implementation Scope

- Add the SDK dependency to `apps/supervisor-agent-worker` using the workspace dependency flow.
- Add SDK runtime config parsing with default-off posture:
  - `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED`
  - `SUPERVISOR_AGENTS_SDK_ALLOWED_TARGETS`
  - `SUPERVISOR_AGENTS_SDK_ALLOWED_TOOLS`
- Add a readiness/admission summary for SDK runtime with stable reason labels:
  - `disabled`
  - `dependency_missing`
  - `provider_config_missing`
  - `model_missing`
  - `allowed_target_missing`
  - `allowed_tool_missing`
  - `admitted`
- Wire the summary into Python `/internal/bridge/readyz` without making Python readiness the
  sole runtime truth.
- Add focused tests for config parsing and readiness/admission summary.

## Non-Scope

- No SDK `Runner.run` execution.
- No ToolSpec-to-SDK tool bridge.
- No public product-path opening.
- No multi-agent workflow runtime.
- No TS/Claude/Agno alternative implementation.

## Acceptance Criteria

- Default behavior is unchanged when the SDK gate is off.
- Readiness reports SDK posture deterministically.
- Missing or invalid SDK config fails closed with stable reason.
- Existing provider function-call pilot remains unchanged.
- No SDK-native type leaks into `packages/contracts`.

## Completion Notes

- Added default-off SDK posture to Python worker readiness.
- Added explicit env config for SDK enabled flag, allowed targets, and allowed tools.
- Added stable admission reasons: `disabled`, `dependency_missing`,
  `provider_config_missing`, `model_missing`, `allowed_target_missing`,
  `allowed_tool_missing`, and `admitted`.
- Added `openai-agents` package dependency but no SDK runner, agent construction, tool bridge,
  or product-path execution.

## Verification

```bash
uv sync --all-packages --dev
uv run --all-packages ruff check apps/supervisor-agent-worker/src tests/supervisor
uv run --all-packages ruff format apps/supervisor-agent-worker/src tests/supervisor --check
uv run --all-packages python -m unittest tests.supervisor.provider_function_calling_suite tests.supervisor.tool_spec_registry_suite
uv run --all-packages python -m unittest tests.contracts.contract_boundary_guardrails_suite
pnpm docs:lint
git diff --check
```
