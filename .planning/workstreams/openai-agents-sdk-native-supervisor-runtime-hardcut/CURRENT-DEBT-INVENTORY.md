---
doc_type: inventory
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Current Debt Inventory: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Scope

This inventory names the current runtime residue that Phase 2-8 must remove or converge. It is not a
permission slip for fallback or compatibility behavior.

## Worker Custom SDK Runner Shell

Owner files:

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_openai_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_mock_runner.py`

Debt:

- Production code models the SDK runtime through repo-owned `AgentsSdkRunner`,
  `AgentsSdkRunRequest`, `AgentsSdkRunResult`, `AgentsSdkToolCall` and
  `run_agents_sdk_runner_shell`.
- The shell validates tool calls, runner result shape, tool execution records and final output,
  which duplicates the SDK loop boundary instead of using it as the native runtime.
- Mock runner is production-importable and keeps old "SDK as protocol" semantics alive.

Target action:

- Replace with `openai_agents_runtime.OpenAIAgentsNativeRuntime`.
- Keep repo-owned sanitized projection and DTO mapping; delete custom runner protocol after native
  runtime call sites are migrated.

## Structured Domain-Agent SDK Adapter Residue

Owner files:

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py`
- `packages/campus-services-agent/src/campus_services_agent/sdk_tool_executor.py`
- `packages/notice-agent/src/campus_notice_agent/sdk_tool_executor.py`
- `tests/supervisor/agents_sdk_runner_suite.py`
- `tests/agent/sdk_only_domain_agent_execution_suite.py`

Debt:

- Domain tools are SDK-only at the adapter boundary, but worker still invokes them through custom
  runner shell types.
- Tool execution request/response records are shaped by repo-owned runner classes, not native SDK
  invocation objects.

Target action:

- Keep package-owned executors.
- Replace shell request types with native runtime invocation DTOs or a single repo-owned thin DTO
  used only at the tool executor boundary.

## RAG Rollout And Non-SDK Synthesis Residue

Owner files:

- `packages/rag-agent/src/campus_rag_agent/service.py`
- `packages/rag-agent/src/campus_rag_agent/rag_sdk_service.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_openai_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_mock_runner.py`
- `tests/agent/rag_agent_sdk_service_suite.py`
- `tests/agent/rag_agent_sdk_rollout_suite.py`

Debt:

- RAG SDK execution remains optional through rollout modes such as `closed`, `shadow`,
  `candidate` and `default_on`.
- Non-SDK answer synthesis can still produce the product answer for query-enabled RAG requests.
- RAG native SDK runner is separate from structured domain-agent SDK runtime.

Target action:

- Keep deterministic preflight, retrieval planning, retrieval execution and evidence selection
  repo-owned.
- Make answer drafting / synthesis SDK-native for query-enabled RAG surfaces.
- Delete rollout/fallback modes rather than preserving a runtime switch.

## Tool Schema And Compiler Split

Owner files:

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/tool_function_schema.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/contract_function_schema.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_tool_bridge.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_sdk_internal_tool_bridge.py`
- `configs/runtime/tools.v1.json`

Debt:

- Structured handoff tools and RAG internal `retrieve_evidence` use separate bridge modules.
- Provider function schema generation is closer to single-source than before, but compiler entry
  points are still split by surface.

Target action:

- Consolidate ToolSpec -> SDK `FunctionTool` compilation in Phase 3.
- Keep `structured_handoff` and `agent_internal` surfaces distinct in policy while sharing compiler
  infrastructure.

## WorkflowPlan SDK Compiler Gap

Owner files:

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/workflow_artifact_registry.py`
- `apps/supervisor-api/internal/structuredplanning/*`
- `apps/supervisor-api/internal/httpapi/execution_multistep_runner.go`

Debt:

- Go owns `WorkflowPlan`, but Python does not yet compile admitted workflow shape into native SDK
  execution primitives.
- Existing single-step SDK calls and multi-step workflow execution remain separate runtime concepts.

Target action:

- Phase 6 compiles Go-owned plan shapes into SDK-native step execution without letting SDK invent
  cross-agent route order.

## Trace And Leakage Risks

Owner files:

- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_trace_projection.py`
- `packages/rag-agent/src/campus_rag_agent/rag_sdk_trace.py`
- `packages/evals/src/campus_evals/workflow_trace_gate.py`

Debt:

- Structured SDK trace and RAG SDK trace use separate projection surfaces.
- Raw SDK/provider/tool data must remain barred from contracts/evals/panel/public response.

Target action:

- Phase 7 unifies sanitized lifecycle vocabulary and adds leakage guards.

## Guard Targets

Forbidden production runtime names after closeout:

- `run_agents_sdk_runner_shell`
- `AgentsSdkRunner`
- `AgentsSdkRunRequest`
- `AgentsSdkRunResult`
- `agents_sdk_mock_runner`
- `rag_sdk_rollout_mode`
- `RagSdkRolloutMode`
- `should_attempt_rag_sdk`
- `maybe_build_rag_sdk_response`
- `shadow`
- `candidate`
- `fallback_only`
