---
doc_type: requirements
status: active
created: 2026-05-08
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 -->

# Requirements: OpenAI Agents SDK Native Supervisor Runtime Hardcut

## Goal

把 Python semantic worker 的 provider-facing runtime 彻底收口到官方 OpenAI Agents SDK：
所有 query-time model turns、function tool loops、guardrails、handoffs 或 agents-as-tools
execution 都通过 SDK `Agent` / `Runner` / `FunctionTool` primitives 完成。Go 继续拥有
deterministic supervisor governance；SDK 只承接 Python 侧语义执行 substrate。

## Problem Statement

当前 repo 已经承认 SDK 方向，但实现仍残留多层自研 runtime：

- `apps/supervisor-agent-worker` 维护 repo-owned `AgentsSdkRunner` protocol、
  `AgentsSdkRunRequest`、`AgentsSdkRunResult` 与 runner shell。
- `run_agents_sdk_runner_shell()` 仍在验证 tool call、runner result、tool execution record，
  相当于把 SDK loop 外包成 repo 自己的 loop。
- `packages/rag-agent` 仍以自研 pipeline 负责 retrieval selection、answer synthesis 和
  final response；SDK synthesis 通过 `maybe_build_rag_sdk_response()` 后置插入。
- RAG SDK rollout mode 仍保留 `closed` / `shadow` / `candidate` / `default_on`，这与硬切
  目标冲突。
- 当前 `retrieve_evidence` 虽已进入 ToolSpec，但仍是 RAG-specific internal bridge，与
  structured agent tools 的 SDK bridge 不是同一 runtime owner。
- multi-step workflow 已有 Go-owned plan / projection truth，但 Python 执行面仍不是
  SDK-native plan compiler。

这会带来三类长期风险：

- provider-facing agent loop 继续由 repo 自研，不能获得 SDK 后续更新保障；
- tool / handoff / trace 语义在 SDK、自研 runner、RAG pipeline 和 Go workflow trace 之间漂移；
- 新 agent 或新 tool 会继续复制过渡态，而不是进入统一 SDK runtime。

## In Scope

- Python worker SDK-native runtime module and runtime factory.
- AgentSpec / ToolSpec -> SDK `Agent` / `FunctionTool` compilation.
- Structured domain-agent execution through official SDK `Runner`.
- RAG answer path hardcut to SDK-native answer drafting / synthesis with bounded
  `retrieve_evidence` function tool after deterministic retrieval planning and evidence selection.
- Removal of RAG SDK rollout modes, shadow/candidate/fallback semantics and non-SDK answer fallback
  for query-enabled RAG surfaces.
- Multi-step Go `WorkflowPlan` -> SDK execution plan compiler for already admitted workflow shapes.
- Sanitized SDK trace / tool lifecycle / handoff projection.
- Readiness and fail-close reasons for SDK dependency/provider/model/key/schema/tool/runtime
  unavailability.
- Tests and guards proving no direct, fallback, shadow, candidate, custom-runner or raw-trace path
  remains.
- Architecture docs and workstream registry alignment.

## Out Of Scope

- Moving Go admission, WorkflowPlan, routing, policy, budgets, timeout/cancel, runtime metrics,
  audit writer or finalization into SDK.
- Moving app auth/session/principal ownership out of `apps/app-api`.
- Moving retrieval backend internals, Qdrant, ingestion or source-truth into SDK tools.
- Introducing hosted web search, hosted file search, code interpreter, shell/computer, remote MCP or
  general web fallback as campus query-time tools.
- Opening new query-serving surfaces.
- Adding state-changing tools, booking, application submission, payment, write actions or HITL.
- Changing public notice card-first posture or exposing notice body by default.
- Renaming domain-agent families.
- Replacing deterministic RAG retrieval planning, retrieval execution, evidence selection,
  source-trust gates or release/alias governance with SDK behavior.

## Success Criteria

- `apps/supervisor-agent-worker` invokes official SDK `Runner` directly for semantic agent
  execution; repo-owned `AgentsSdkRunner` protocol and mock runner are deleted.
- Structured domain agents and RAG agent share the same SDK runtime factory and tool compiler.
- `run_agents_sdk_runner_shell()` and equivalent repo-owned SDK loop wrappers no longer exist.
- `rag_sdk_rollout_mode`, `RagSdkRolloutMode`, `should_attempt_rag_sdk()` and
  `maybe_build_rag_sdk_response()` rollout behavior no longer exist.
- `rag-agent` query-enabled answer drafting / synthesis is SDK-native and fail-closes when SDK
  runtime is unavailable; deterministic pre-retrieval, retrieval and evidence-selection stages may
  remain repo-owned but cannot produce a non-SDK final answer for the same request.
- `retrieve_evidence` is compiled from ToolSpec into an SDK `FunctionTool`, remains
  `agent_internal`, and cannot widen scope/authz/selector/budget beyond Go / RAG plan admission.
- Structured domain tools are compiled from ToolSpec into SDK `FunctionTool` with generated schema,
  not hand-authored provider schemas.
- Multi-step execution consumes Go-owned `WorkflowPlan`; SDK may realize steps through direct agent
  runs, agents-as-tools, or handoff only when the plan explicitly permits that ownership shape.
- SDK traces are converted to repo-owned sanitized projections; sensitive data and raw tool/provider
  payloads are not stored in contracts/evals/panel/public response.
- Readiness reports stable reasons for SDK runtime unavailable, dependency missing, provider config
  missing, model missing, key missing, schema missing, tool not admitted, and plan not admitted.
- Guard tests fail on:
  - repo-owned provider-loop reintroduction
  - RAG rollout/shadow/candidate/fallback reintroduction
  - custom `AgentsSdkRunner` protocol reintroduction
  - direct domain adapter fallback reintroduction
  - raw SDK/provider/tool payload leakage
  - SDK agent routing bypassing Go `allowed_tools` / WorkflowPlan

## Negative Completion Criteria

This workstream is not complete if any of these remain true:

- A query-enabled RAG request can complete through non-SDK synthesis when SDK runtime is disabled or
  unavailable.
- A structured domain-agent request can complete through a non-SDK provider-facing loop.
- The worker still defines or imports repo-owned `AgentsSdkRunner` / `AgentsSdkRunRequest` /
  `AgentsSdkRunResult` as production runtime contracts.
- RAG SDK rollout modes remain as product/runtime behavior.
- SDK function schemas can drift from ToolSpec without deterministic guard failure.
- SDK raw trace, raw provider response, raw tool output or SDK-native object appears in
  `packages/contracts`, app-api/panel response, eval canonical fixture, workflow trace summary or
  public response.
- SDK decides cross-agent routing freely when Go WorkflowPlan did not admit that branch.
- SDK-generated behavior can widen retrieval scope, selector, authz, budget, serving surface or
  version constraints.

## Official SDK Alignment

The implementation must align with current official OpenAI Agents SDK docs:

- Use `Agent` and `Runner` for model turns, tools, handoffs, guardrails and sessions.
- Use function tools for repo-owned local/runtime execution.
- Use handoffs only for specialist ownership transfer.
- Use agents-as-tools where a manager remains answer owner.
- Use SDK tracing as internal evidence, but export only sanitized repo-owned projections.
- Treat the SDK's global flexibility as an implementation substrate. This repo still chooses a
  hardcut for Python semantic runtime because the current self-built loop has become product debt.

References:

- <https://openai.github.io/openai-agents-python/quickstart/>
- <https://openai.github.io/openai-agents-python/agents/>
- <https://openai.github.io/openai-agents-python/tools/>
- <https://openai.github.io/openai-agents-python/handoffs/>
- <https://openai.github.io/openai-agents-python/tracing/>
- <https://openai.github.io/openai-agents-python/running_agents/>

## Verification Baseline

Focused implementation verification should include:

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runtime_native_suite tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.tool_spec_registry_suite -q
uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_native_runtime_suite tests.agent.test_campus_services_agent tests.agent.test_notice_agent -q
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.evals.tool_family_denominator_suite -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src packages/rag-agent/src packages/campus-services-agent/src packages/notice-agent/src tests/supervisor tests/agent tests/evals
uv run --all-packages ruff format apps/supervisor-agent-worker/src packages/rag-agent/src packages/campus-services-agent/src packages/notice-agent/src tests/supervisor tests/agent tests/evals --check
pnpm decomposition:lint
git diff --check
```

Repo-wide closeout should run the default root `AGENTS.md` verification set when shared contracts,
runtime policy or generated schemas change.
