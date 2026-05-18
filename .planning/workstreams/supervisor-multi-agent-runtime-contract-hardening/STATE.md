---
doc_type: state
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# State: Supervisor Multi-Agent Runtime Contract Hardening

## Current Slice

The runtime-contract hardening workstream is complete:

- repo-owned `AgentSpec` registry artifact at `configs/runtime/agents.v1.json`
- Python `AgentSpec` loader plus delegate-map drift coverage
- Python dispatch fail-close for inactive/closed AgentSpec targets
- Go `WorkflowPlan.allowed_agents` projection plus AgentSpec plan validation
- Go/Python/shared-contract `AgentInvocation` projection in workflow trace
- multi-step `AgentInvocation` parent edges and consumed projection refs
- `WorkflowRunStore` invocation persistence for in-memory and PostgreSQL backends
- `AgentRequest.workflow_context` execution-wire projection envelope with fail-close required
  projection behavior
- eval gate coverage for invocation presence, target alignment, parent edges, projection refs,
  raw context leak, bounded tool summary and tool provenance / fail-close reasons
- observability contract mapping for request, workflow run, invocation, tool, projection,
  source/evidence and provider auxiliary ids
- bridge payload decode parity restored for `place_lookup`

## Next Step

No next phase remains in this workstream. Future product workflow expansion belongs to deferred
`governed-multi-agent-workflow-runtime` or a narrower successor workstream, starting from a
readiness matrix rather than reopening this contract-hardening line by default.

## Blockers

- None.

## Verification

Current implementation verification passed on 2026-05-04:

```bash
go test ./internal/execution ./internal/contracts ./internal/runtimepolicy ./internal/httpapi ./internal/structuredplanning
uv run --all-packages python -m unittest tests.contracts.canonical_supervisor_execution_schema_suite tests.contracts.supervisor_execution_fixture_matrix_suite tests.contracts.contract_models_runtime_and_tools_suite tests.evals.workflow_trace_gate_suite tests.supervisor.agent_dispatch_suite -q
uv run --all-packages python -m scripts.generate_supervisor_execution_contracts --check
pnpm docs:lint
uv run --all-packages ruff check apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/supervisor_execution_contract.py packages/contracts/src/campus_contracts/models_runtime.py packages/contracts/src/campus_contracts/models.py packages/contracts/src/campus_contracts/__init__.py packages/evals/src/campus_evals/workflow_trace_gate.py tests/contracts/canonical_supervisor_execution_schema_suite.py tests/contracts/contract_models_runtime_and_tools_suite.py tests/contracts/contract_models_test_support.py tests/contracts/supervisor_execution_fixture_matrix_suite.py tests/evals/workflow_trace_gate_suite.py tests/supervisor/agent_dispatch_suite.py
uv run --all-packages ruff format apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/supervisor_execution_contract.py packages/contracts/src/campus_contracts/models_runtime.py packages/contracts/src/campus_contracts/models.py packages/contracts/src/campus_contracts/__init__.py packages/evals/src/campus_evals/workflow_trace_gate.py tests/contracts/canonical_supervisor_execution_schema_suite.py tests/contracts/contract_models_runtime_and_tools_suite.py tests/contracts/contract_models_test_support.py tests/contracts/supervisor_execution_fixture_matrix_suite.py tests/evals/workflow_trace_gate_suite.py tests/supervisor/agent_dispatch_suite.py --check
```

Additional focused verification run during closeout:

```bash
go test ./internal/execution -run 'TestBridgePayloadForHandoff(Project|Fails|Uses)'
go test ./internal/httpapi -run TestWorkflowSourceIDsCollectsStringSliceRefs
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite -q
```

## Continuity Notes

- This workstream is about multi-agent runtime contract hardening, not Codex CLI usage workflow.
- Existing unrelated dirty worktree changes must remain untouched unless they overlap this slug.
- Treat `governed-multi-agent-workflow-runtime` as a deferred implementation/runtime workstream;
- this workstream is its completed contract prerequisite.
- Reopen this workstream only if a new agent/tool bypasses AgentSpec/ToolSpec, workflow trace omits
  invocation/projection/tool provenance, raw provider/source payload leaks into contracts/eval/panel
  or workflow trace, or deferred multi-agent runtime implementation changes the contract boundary.
