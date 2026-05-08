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
**Current Phase:** Phase 3 - ToolSpec To FunctionTool Compiler
**Last Activity:** 2026-05-08
**Last Activity Description:** Completed Phase 1 planning artifacts, Phase 2 native SDK runtime
factory foundation, and post-implementation review fixes.

## Current Slice

Phase 1 and Phase 2 are complete. Phase 3 is next.

Immediate next implementation slice:

- consolidate structured and RAG-internal ToolSpec -> SDK `FunctionTool` compilation;
- keep `structured_handoff` and `agent_internal` policy distinct while sharing compiler machinery;
- preserve existing schema drift guards.

## Baseline Facts

- `sdk-only-domain-agent-execution-hardcut` is completed and removed direct structured domain-agent
  adapter fallback for `sdk_adapter_admitted` tools.
- Current worker still has custom SDK runner shell code and production `AgentsSdkRunner` protocol.
- Current RAG SDK path still has rollout semantics and non-SDK answer synthesis fallback.
- RAG deterministic retrieval planning, retrieval execution and evidence selection are not SDK
  migration targets; SDK hardcut applies to provider-facing answer drafting / synthesis and tool
  loop substrate.
- Go `supervisor-api` remains deterministic admission / WorkflowPlan / ToolSpec / finalization
  owner.
- Official OpenAI Agents SDK supports agents, tools, handoffs and tracing; this workstream uses those
  primitives as Python runtime substrate only.
- Phase 2 added `OpenAIAgentsNativeRuntime` as the production factory foundation, but existing call
  sites still use the old custom runner shell until Phase 4 / Phase 8.

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

## Session Continuity

**Stopped At:** Phase 1 and Phase 2 completed; Phase 3 ready
**Resume File:** `README.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`,
`CURRENT-DEBT-INVENTORY.md`, `SDK-PRIMITIVE-MAPPING.md`
