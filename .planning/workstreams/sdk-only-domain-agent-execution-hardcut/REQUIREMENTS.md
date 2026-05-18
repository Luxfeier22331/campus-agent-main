---
doc_type: requirements
status: active
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Requirements: SDK-only Domain-Agent Execution Hardcut

## Goal

彻底收口 structured domain-agent runtime，让 `sdk_adapter_admitted` 只代表一种执行方式：
Go-admitted handoff 进入 Python worker 的 Agents SDK shell，再调用 repo-owned SDK tool executor。
同一 tool 不再同时存在 direct adapter 与 SDK adapter 两套 online runtime。

## Problem Statement

当前 repo 已经把 selected structured tools 推进到 SDK adapter 默认接纳，但仍存在双轨债务：

- worker delegate 仍可在 SDK runner 不可用时调用 direct package delegate
- `packages/campus-services-agent` 与 `packages/notice-agent` 仍保留 online direct
  `service.py` / `tool_adapter.py` API
- SDK bridge executor logic 主要集中在 worker，domain package ownership 不够清晰
- observability 可能按 SDK path / direct path 分叉
- guardrail 还没有硬性禁止 future structured tools 重新引入 direct fallback

这些问题会让 `tool` 语义、执行 owner、runtime evidence 与 fail-close 行为继续漂移。

## In Scope

- `apps/supervisor-agent-worker` delegate routing hard cut.
- `packages/campus-services-agent` structured tool SDK executor ownership.
- `packages/notice-agent` structured tool SDK executor ownership.
- Direct online adapter deletion / retirement for current SDK-admitted structured tools.
- Tests and evals that currently assume direct package delegate runtime.
- ToolSpec, function schema generation and SDK bridge drift guards.
- SDK runtime readiness / admission semantics for missing config.
- Canonical lifecycle projection:
  - runner admitted / rejected
  - tool call attempted
  - tool execution completed / failed
  - bounded result used
  - final output accepted / fail-closed

## Out Of Scope

- Replacing Go supervisor-api orchestration, admission or finalization with SDK.
- Moving ToolSpec, AgentSpec or runtime policy ownership into SDK.
- Exposing `retrieve_evidence` as a structured handoff tool.
- Changing RAG answer synthesis or retrieval source-truth ownership.
- Opening new query-serving surfaces.
- Adding multi-step graph expansion beyond already admitted workflow contracts.
- Introducing hosted tools, MCP, web search, code interpreter, shell/filesystem, object-store reads
  or raw SQL as query-time tools.

## Success Criteria

- `sdk_adapter_admitted` is enforced as SDK-required in worker runtime.
- `agent_delegates.py` contains no direct fallback calls for SDK-admitted domain tools.
- Missing SDK dependency, runner, provider config, model config, API key or function schema fails
  closed with stable reason labels.
- Direct online APIs are removed from:
  - `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
  - `packages/campus-services-agent/src/campus_services_agent/service.py`
  - `packages/notice-agent/src/campus_notice_agent/tool_adapter.py`
  - `packages/notice-agent/src/campus_notice_agent/service.py`
- If package-local test helpers are still needed, they are named as fixtures/helpers and cannot be
  imported by worker online runtime.
- Domain package SDK tool executors own bounded query-service execution and result shaping.
- Worker SDK bridge only assembles SDK tools, invokes executors and maps SDK output into repo-owned
  `AgentResponse`.
- Provider function schemas are generated from ToolSpec `payload_schema_ref` and contract metadata,
  not hand-written in parallel.
- All structured SDK paths emit the same sanitized lifecycle projection.
- Guard tests fail when:
  - `_should_route_to_agents_sdk` or equivalent SDK-preference branch returns
  - direct package delegate fallback is imported into worker delegate runtime
  - direct `tool_adapter.py` online dispatch is reintroduced
  - provider schema diverges from contract schema metadata

## Negative Completion Criteria

This workstream is not complete if any of these remain true:

- SDK-disabled config can still answer an SDK-admitted structured request through direct adapter.
- A single tool can be executed through both SDK and direct online runtime in production code.
- Worker owns domain query result semantics instead of package-owned SDK executor.
- `ToolSpec` and provider function schema can drift without a failing test.
- Raw SDK/provider/tool payload enters contracts, workflow trace, eval canonical assets or panel.

## Verification Baseline

Focused verification for implementation phases:

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.tool_spec_registry_suite -q
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent tests.agent.test_notice_agent -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src packages/campus-services-agent/src packages/notice-agent/src tests/supervisor tests/agent
uv run --all-packages ruff format apps/supervisor-agent-worker/src packages/campus-services-agent/src packages/notice-agent/src tests/supervisor tests/agent --check
pnpm decomposition:lint
git diff --check
```

Repo-wide closeout may run the default verification set from root `AGENTS.md` if the implementation
touches shared contracts or runtime policy broadly.
