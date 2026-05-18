---
doc_type: state
workstream: openai-agents-sdk-native-supervisor-runtime-hardcut
status: completed
created: 2026-05-08
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# State: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Current Position

**Status:** completed
**Current Phase:** Phase 10 completed
**Last Activity:** 2026-05-10
**Last Activity Description:** Completed Phase 6-10 hardcut closeout: bridge v6 now requires
Go-owned `workflow_plan` plus `AgentRequest.workflow_context`, Python validates the admitted
workflow before SDK/internal-function execution, RAG synthesis uses `OpenAIAgentsRagRuntime`, and
readiness / guardrails describe a single SDK-native semantic runtime.

## Current Slice

All planned phases are closed. There is no active implementation slice in this workstream.
Completion audit evidence is recorded in `GAP-LEDGER.md`.

## Baseline Facts

- `sdk-only-domain-agent-execution-hardcut` is completed and removed direct structured domain-agent
  adapter fallback for `sdk_adapter_admitted` tools.
- Current worker no longer has the production `AgentsSdkRunner` shell.
- Current RAG SDK path now uses `OpenAIAgentsRagRuntime` directly.
- RAG deterministic retrieval planning, retrieval execution and evidence selection are not SDK
  migration targets; SDK hardcut applies to provider-facing answer drafting / synthesis and tool
  loop substrate.
- Go `supervisor-api` remains deterministic admission / WorkflowPlan / ToolSpec / finalization
  owner.
- Official OpenAI Agents SDK supports agents, tools, handoffs and tracing; this workstream uses those
  primitives as Python runtime substrate only.
- Structured SDK call sites now use the production native runtime foundation and unified
  FunctionTool compiler.
- Query-enabled RAG synthesis now requires an explicit SDK-native runtime at the production service
  boundary; unavailable provider/model/key/dependency states fail closed rather than enabling
  non-SDK synthesis.
- Bridge v6 delegate parsing requires `runtime_decisions.workflow_plan`; the selected
  `AgentRequest.workflow_context` must match the Go-admitted step, target, payload kind, allowed
  tools, projection kind and expected artifacts.
- Worker readiness reports stable SDK-native admission reasons, including
  `provider_key_missing`, and cannot imply a fallback answer path.

## Blockers

None recorded.

## Latest Verification

Planning review verification:

```bash
pnpm exec markdownlint-cli2 '.planning/workstreams/openai-agents-sdk-native-supervisor-runtime-hardcut/**/*.md' .planning/WORKSTREAMS.md
git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/openai-agents-sdk-native-supervisor-runtime-hardcut
```

Observed result on 2026-05-08:

- markdown lint: `Summary: 0 error(s)`
- diff whitespace check: exit 0

Phase 2 TDD verification:

```bash
uv run --all-packages python -m unittest tests.supervisor.openai_agents_runtime_suite -q
```

Observed result on 2026-05-08:

- initial RED: `ModuleNotFoundError: No module named 'campus_supervisor_agent_worker.openai_agents_runtime'`
- GREEN after implementation: `Ran 4 tests in 0.621s` / `OK`

Post-implementation review verification:

```bash
uv run --all-packages python -m unittest tests.supervisor.openai_agents_runtime_suite -q
```

Observed result on 2026-05-08:

- RED for leaked production test state: `runner_captures` existed on runtime instance
- RED for dropped explicit runner tool calls: `len(result.tool_calls) == 0`
- GREEN after fixes: `Ran 6 tests in 0.612s` / `OK`

Focused review lint:

```bash
uv run --all-packages ruff check apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py tests/supervisor/openai_agents_runtime_suite.py tests/supervisor/test_openai_agents_runtime.py
uv run --all-packages ruff format apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py tests/supervisor/openai_agents_runtime_suite.py tests/supervisor/test_openai_agents_runtime.py --check
pnpm exec markdownlint-cli2 '.planning/workstreams/openai-agents-sdk-native-supervisor-runtime-hardcut/**/*.md' .planning/WORKSTREAMS.md
git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/openai-agents-sdk-native-supervisor-runtime-hardcut apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py tests/supervisor/openai_agents_runtime_suite.py tests/supervisor/test_openai_agents_runtime.py
```

Observed result on 2026-05-08:

- ruff check: `All checks passed!`
- ruff format check: `3 files already formatted`
- markdown lint: `Summary: 0 error(s)`
- diff whitespace check: exit 0

Current hardcut slice verification:

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_service_suite tests.supervisor.rag_agents_sdk_delegate_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_agentic_depth_runtime_suite tests.agent.rag_agent_workflow_projection_grounding_suite tests.agent.test_rag_retrieval_plan -q
uv run --all-packages python -m unittest tests.supervisor.tool_spec_registry_suite tests.supervisor.agents_sdk_tool_bridge_suite -q
cd apps/supervisor-api && go test ./internal/runtimepolicy -run 'TestToolSpecRegistryValidationRejectsLegacySdkAdapterCandidatePosture|TestLoadToolSpecRegistryLoadsDefaultStructuredTools'
```

Observed result on 2026-05-08:

- focused worker/RAG suite: `Ran 52 tests in 0.111s` / `OK`
- tool registry/bridge suite: `Ran 18 tests ... OK`
- Go runtimepolicy tests: `ok`

Phase 6-8 focused verification:

```bash
uv run --all-packages python -m unittest tests.supervisor.openai_agents_runtime_suite tests.supervisor.openai_agents_runtime_projection_suite tests.supervisor.openai_agents_workflow_plan_suite tests.supervisor.openai_agents_rag_runtime_suite tests.supervisor.openai_agents_runtime_hardcut_guardrails_suite tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.agents_sdk_internal_tool_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.admitted_agent_execution_suite tests.supervisor.tool_execution_registry_suite tests.api.supervisor_api_bridge_handoff_suite tests.api.supervisor_api_bridge_go_fixture_suite tests.contracts.supervisor_execution_fixture_matrix_suite -q
```

Observed result on 2026-05-10:

- focused supervisor / bridge / contract suite: `Ran 81 tests in 0.501s` / `OK`

Phase 9 product-path focused verification:

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_service_suite tests.agent.rag_agent_sdk_tools_suite tests.agent.rag_agent_sdk_trace_suite tests.supervisor.rag_agents_sdk_delegate_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_agentic_depth_runtime_suite tests.agent.rag_agent_workflow_projection_grounding_suite tests.agent.campus_services_academic_calendar_suite -q
```

Observed result on 2026-05-10:

- focused RAG / product-path suite: `Ran 59 tests in 0.572s` / `OK`

## Session Continuity

**Stopped At:** workstream completed; no active phase remains
**Resume File:** `README.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`,
`GAP-LEDGER.md`, `CURRENT-DEBT-INVENTORY.md`, `SDK-PRIMITIVE-MAPPING.md`
