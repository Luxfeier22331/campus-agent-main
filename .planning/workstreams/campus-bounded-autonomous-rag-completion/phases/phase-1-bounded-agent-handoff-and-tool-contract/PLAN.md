---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Bounded Agent Handoff And Tool Contract

## Objective

Harden RAG handoff so supervisor/domain-agent context is typed, bounded, trace-safe and governed by
repo-owned ToolSpec/runtime policy.

## Dependencies

- Phase 0 gap matrix is complete.
- Phase 0 identifies the exact Go, Python and contract files that require changes.
- No unresolved contract ownership question remains around `AgentRequest.workflow_context`.

## Desired End State

- RAG can consume cross-agent context only as admitted projection refs.
- Raw source bodies, raw provider traces, raw prompt history and raw OCR/source dumps are rejected at
  the earliest boundary.
- Missing required projection refs fail closed.
- Allowed tools for RAG are derived from repo-owned ToolSpec/runtime policy.
- Internal retrieval executable seam stays internal and does not become a public/provider tool.

## Primary Code Targets

Phase 0 may refine this list. Expected targets:

- `packages/contracts/src/campus_contracts/models_runtime.py`
- `packages/contracts/src/campus_contracts/models_tools.py`
- `packages/contracts/schemas/agent-handoff.v1.schema.json`
- `apps/supervisor-api/internal/execution/bridge_payload.go`
- `apps/supervisor-api/internal/runtimepolicy/tool_registry.go`
- `apps/supervisor-api/internal/runtimepolicy/tool_registry_test.go`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_spec_registry.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_context_projection_codecs.py`
- `packages/rag-agent/src/campus_rag_agent/service.py`
- `packages/rag-agent/src/campus_rag_agent/service_observability.py`

## Primary Test Targets

- `tests/contracts/contract_models_runtime_and_tools_suite.py`
- `tests/contracts/supervisor_execution_fixture_matrix_suite.py`
- `tests/api/supervisor_api_bridge_contract_suite.py`
- `tests/api/supervisor_api_bridge_handoff_suite.py`
- `tests/supervisor/agent_dispatch_suite.py`
- `tests/supervisor/tool_spec_registry_suite.py`
- `tests/agent/rag_agent_agentic_runtime_contract_suite.py`

## TDD Plan

1. Add failing contract tests:
   - `workflow_context.projection_refs` rejects `raw_response`, `raw_body`, `raw_html`,
     `raw_ocr_text`, `prompt`, `provider_trace`, `tool_trace` and arbitrary payload keys.
   - required projection refs must include `projection_id`, `projection_kind`, `source_step_id`,
     `content_hash` and safety/visibility metadata required by Phase 0.
2. Add failing bridge tests:
   - bridge v6 rejects raw workflow context keys before dispatch.
   - missing required projection for a multi-step RAG handoff fails closed.
3. Add failing tool tests:
   - RAG delegate cannot receive extra allowed tools not in ToolSpec.
   - `retrieval.query` is not exposed as a provider/user-facing structured tool unless explicitly
     admitted by runtime policy.
4. Add failing agent tests:
   - RAG receives only projection metadata, not raw cross-agent payload.
   - trace-safe observability includes projection ids/kinds but not projection bodies.

## Implementation Steps

1. Freeze projection admission shape.
   - Prefer existing `WorkflowAgentContext` and projection refs in `models_runtime.py`.
   - Add only stable metadata fields to shared contracts.
   - Do not add retrieval executable types to `packages/contracts`.
2. Harden contract validation.
   - Centralize raw-key rejection for projection refs.
   - Reject unknown raw payload-like keys in workflow context.
   - Preserve backwards-compatible valid fixture fields only when they are already accepted truth.
3. Harden bridge parsing.
   - Fail closed before agent dispatch when workflow context is malformed.
   - Ensure error code/reason is deterministic and trace-safe.
4. Harden allowed tool derivation.
   - Check Go handoff `allowed_tools` against ToolSpec/runtime policy.
   - Check Python dispatch against ToolSpec registry before delegate invocation.
   - Keep `retrieval.query` as RAG internal observability/tool selection label only.
   - If Phase 0 shows Go ToolSpec behavior is already sufficient, verify existing Go registry tests
     instead of editing Go runtimepolicy files.
5. Update RAG observability.
   - Include projection id/kind/count in safe details if already available.
   - Do not include raw projected content.
6. Update docs/planning.
   - Phase summary records accepted projection kinds, required metadata, fail-close reasons and
     verification evidence.

## Write Set

Allowed:

- Contract model/schema files listed above
- Supervisor bridge/dispatch/tool policy files listed above
- Go ToolSpec registry files listed above only when Phase 0 proves Go allowed-tools behavior needs
  changes; otherwise they are verification targets only
- RAG service/observability files only if Phase 0 shows RAG currently consumes raw context
- Focused tests listed above
- Phase summary/state

Not allowed:

- Retrieval-core execution types in `packages/contracts`
- New product capability opening
- Provider SDK-native graph or raw trace schema as canonical repo truth

## Verification

Run focused tests:

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

Run formatting/lint checks for changed Python:

```bash
uv run --all-packages ruff check \
  packages/contracts/src/campus_contracts \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker \
  packages/rag-agent/src/campus_rag_agent \
  tests/contracts tests/api tests/supervisor tests/agent
uv run --all-packages ruff format \
  packages/contracts/src/campus_contracts \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker \
  packages/rag-agent/src/campus_rag_agent \
  tests/contracts tests/api tests/supervisor tests/agent \
  --check
```

If Go bridge payload changes:

```bash
cd apps/supervisor-api && go test ./internal/execution ./internal/structuredplanning ./internal/runtimepolicy
```

If only Go ToolSpec registry behavior is under verification and no Go code changes:

```bash
cd apps/supervisor-api && go test ./internal/runtimepolicy
```

## Exit Criteria

- Raw workflow context and raw projection payloads fail closed.
- Required projection absence fails closed.
- Tool allowlist drift is rejected before delegate execution.
- RAG traces expose safe projection metadata only.
- Phase summary records exact policy and residual deferred work.

## Risks

- Risk: over-hardening rejects existing valid fixtures.
  Mitigation: update only fields Phase 0 identifies as unsafe, then preserve valid fixture matrix.
- Risk: ToolSpec drift between Go and Python.
  Mitigation: add both Go-side and Python-side checks when both seams are touched.
- Risk: contracts become infrastructure-specific.
  Mitigation: keep fields semantic and avoid provider/runtime class names.
