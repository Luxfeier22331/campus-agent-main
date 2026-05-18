---
doc_type: gap_ledger
status: completed
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Completion Audit

| Requirement | Status | Evidence |
| --- | --- | --- |
| Worker invokes official SDK runtime directly for semantic agent execution | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_runtime.py`, `tests/supervisor/openai_agents_runtime_suite.py` |
| Structured domain agents use one SDK-native executor path | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/admitted_agent_execution.py`, `tests/supervisor/admitted_agent_execution_suite.py` |
| ToolSpec drives SDK `FunctionTool` schema and execution descriptors | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_tool_bridge.py`, `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_function_tools.py`, `tests/supervisor/agents_sdk_tool_bridge_suite.py`, `tests/supervisor/agents_sdk_internal_tool_suite.py` |
| RAG answer synthesis hard-cuts to SDK-native runtime after deterministic retrieval/evidence stages | closed | `packages/rag-agent/src/campus_rag_agent/service.py`, `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`, `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_rag_runtime.py`, `tests/agent/rag_agent_sdk_service_suite.py`, `tests/supervisor/openai_agents_rag_runtime_suite.py` |
| RAG SDK rollout / shadow / candidate / fallback modes are removed as runtime behavior | closed | `tests/agent/rag_agent_sdk_rollout_suite.py`, `tests/supervisor/openai_agents_runtime_hardcut_guardrails_suite.py` |
| Bridge v6 delegate requests require Go-owned WorkflowPlan and matching workflow context | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py`, `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_workflow_plan.py`, `tests/supervisor/openai_agents_workflow_plan_suite.py`, `tests/api/supervisor_api_bridge_handoff_suite.py`, `tests/contracts/supervisor_execution_fixture_matrix_suite.py` |
| Python does not invent route order or widen allowed tools at execution time | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_workflow_plan.py`, `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/admitted_agent_execution.py`, `tests/supervisor/openai_agents_workflow_plan_suite.py`, `tests/supervisor/admitted_agent_execution_suite.py` |
| SDK readiness exposes stable fail-close reasons including provider key absence | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runtime_policy.py`, `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_readiness.py`, `tests/supervisor/agents_sdk_runtime_policy_suite.py` |
| Legacy RAG SDK runner naming and custom shell residue cannot return silently | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/openai_agents_rag_runtime.py`, `tests/supervisor/openai_agents_runtime_hardcut_guardrails_suite.py` |
| Sanitized SDK trace / projection remains repo-owned and bounded | closed | `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_trace_projection.py`, `packages/rag-agent/src/campus_rag_agent/rag_sdk_trace.py`, `tests/supervisor/openai_agents_runtime_projection_suite.py`, `tests/agent/rag_agent_sdk_trace_suite.py` |

## Verification Evidence

Focused supervisor / bridge / contract verification:

```bash
uv run --all-packages python -m unittest tests.supervisor.openai_agents_runtime_suite tests.supervisor.openai_agents_runtime_projection_suite tests.supervisor.openai_agents_workflow_plan_suite tests.supervisor.openai_agents_rag_runtime_suite tests.supervisor.openai_agents_runtime_hardcut_guardrails_suite tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.agents_sdk_internal_tool_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.admitted_agent_execution_suite tests.supervisor.tool_execution_registry_suite tests.api.supervisor_api_bridge_handoff_suite tests.api.supervisor_api_bridge_go_fixture_suite tests.contracts.supervisor_execution_fixture_matrix_suite -q
```

Observed result on 2026-05-10:

- `Ran 81 tests in 0.501s` / `OK`

Focused RAG / product-path verification:

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_service_suite tests.agent.rag_agent_sdk_tools_suite tests.agent.rag_agent_sdk_trace_suite tests.supervisor.rag_agents_sdk_delegate_suite tests.agent.rag_agent_agentic_runtime_contract_suite tests.agent.rag_agent_agentic_depth_runtime_suite tests.agent.rag_agent_workflow_projection_grounding_suite tests.agent.campus_services_academic_calendar_suite -q
```

Observed result on 2026-05-10:

- `Ran 59 tests in 0.572s` / `OK`

## Remaining Boundaries

- Go `apps/supervisor-api` remains admission, WorkflowPlan, ToolSpec, budget, policy and
  finalization owner.
- Deterministic RAG retrieval planning, retrieval backend execution, evidence selection,
  source-trust and release / alias governance remain repo-owned and SDK-neutral.
- `packages/contracts` remains SDK-free; only repo-owned DTOs and sanitized projections cross the
  app/package boundary.
- Future official SDK API changes can reopen this workstream, but should not reintroduce a
  repo-owned provider loop or rollout/fallback execution mode.
