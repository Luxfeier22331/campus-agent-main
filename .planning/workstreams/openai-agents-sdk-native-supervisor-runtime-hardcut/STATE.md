---
doc_type: state
workstream: openai-agents-sdk-native-supervisor-runtime-hardcut
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# State: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Current Position

**Status:** active
**Current Phase:** Phase 8 - Residual Deletion And Drift Guards
**Last Activity:** 2026-05-08
**Last Activity Description:** Completed the current hardcut slice: unified SDK FunctionTool
factory, removed legacy `sdk_adapter_candidate` posture, hard-cut RAG production service to require
an explicit SDK runner, and replaced nullable worker injection with a concrete fail-closed runtime.

## Current Slice

Phase 1 and Phase 2 are complete. The current implementation slice also landed the production RAG
hardcut seam and residual cleanup around nullable runner injection.

Immediate next implementation slice:

- finish remaining residual deletion and drift guards;
- keep observability naming aligned with native runtime truth;
- broaden focused verification from worker/RAG seam to eval and product-path acceptance.

## Baseline Facts

- `sdk-only-domain-agent-execution-hardcut` is completed and removed direct structured domain-agent
  adapter fallback for `sdk_adapter_admitted` tools.
- Current worker no longer has the production `AgentsSdkRunner` shell.
- Current RAG SDK path now uses the native runtime wrapper directly.
- RAG deterministic retrieval planning, retrieval execution and evidence selection are not SDK
  migration targets; SDK hardcut applies to provider-facing answer drafting / synthesis and tool
  loop substrate.
- Go `supervisor-api` remains deterministic admission / WorkflowPlan / ToolSpec / finalization
  owner.
- Official OpenAI Agents SDK supports agents, tools, handoffs and tracing; this workstream uses those
  primitives as Python runtime substrate only.
- Structured SDK call sites now use the production native runtime foundation and unified
  FunctionTool compiler.
- Query-enabled RAG synthesis now requires an explicit SDK runner at the production service
  boundary; test/eval helper wrappers own their own explicit in-process runner injection and no
  longer rely on a nullable production seam.

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

## Session Continuity

**Stopped At:** explicit RAG runner hardcut and registry posture cleanup completed; residual
deletion, wider eval acceptance and docs closeout next
**Resume File:** `README.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`,
`CURRENT-DEBT-INVENTORY.md`, `SDK-PRIMITIVE-MAPPING.md`
