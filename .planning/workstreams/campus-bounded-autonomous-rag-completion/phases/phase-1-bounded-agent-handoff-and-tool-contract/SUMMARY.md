---
doc_type: phase_summary
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Summary: Bounded Agent Handoff And Tool Contract

## Status

Completed in current worktree.

## Implemented

- `WorkflowAgentContext.projection_refs` now requires bounded projection metadata:
  `projection_id`, `source_step_id`, `projection_kind`, `content_hash` and non-empty `safety`.
- Existing raw workflow trace key/value rejection still applies recursively to projection refs.
- Missing `required_projection_kind` still fails closed.
- Python dispatcher active ToolSpec coverage now includes `academic_calendar_lookup`, preventing
  new active structured handoff tools from bypassing dispatcher acceptance coverage.

## Accepted Projection Ref Shape

Projection refs remain metadata envelopes only. They may identify bounded projections and their
safety summaries, but they must not carry raw projection body, raw source HTML, OCR text, provider
trace or prompt transcript.

Required fields:

| Field | Meaning |
| --- | --- |
| `projection_id` | Stable projection reference id |
| `source_step_id` | Producing workflow step |
| `projection_kind` | Bounded context kind such as `notice_context` |
| `content_hash` | Body identity without carrying body content |
| `safety` | Non-empty safety/visibility/length summary |

## Files Changed

- `packages/contracts/src/campus_contracts/models_runtime.py`
- `tests/contracts/contract_models_runtime_and_tools_suite.py`
- `tests/supervisor/agent_dispatch_suite.py`

## Verification Evidence

```bash
uv run --all-packages python -m unittest \
  tests.contracts.contract_models_runtime_and_tools_suite \
  tests.contracts.supervisor_execution_fixture_matrix_suite
```

Result: 39 tests passed.

```bash
uv run --all-packages python -m unittest \
  tests.contracts.contract_models_runtime_and_tools_suite \
  tests.contracts.supervisor_execution_fixture_matrix_suite \
  tests.api.supervisor_api_bridge_contract_suite \
  tests.api.supervisor_api_bridge_handoff_suite \
  tests.supervisor.agent_dispatch_suite \
  tests.supervisor.tool_spec_registry_suite \
  tests.agent.rag_agent_agentic_runtime_contract_suite
```

Result: included in the 223-test focused gate.

## Deferred Work

None for current RAG handoff acceptance. Provider-native graph or raw provider trace schemas remain
out of scope.
