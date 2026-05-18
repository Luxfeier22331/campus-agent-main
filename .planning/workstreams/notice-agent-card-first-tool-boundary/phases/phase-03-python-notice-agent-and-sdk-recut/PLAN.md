---
doc_type: phase_plan
workstream: notice-agent-card-first-tool-boundary
phase: 03-python-notice-agent-and-sdk-recut
status: planned
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 3: Python Notice-Agent And SDK Recut

## Goal

Align Python notice-agent, provider function calling and Agents SDK pilot with card-first notice semantics.

## Depends On

- Phase 1 contract and ToolSpec recut.
- Phase 2 Go internal query semantics if Python tests depend on Go response shape.

## Python Runtime Design

Python notice-agent remains a thin semantic/domain adapter. It should:

- Accept discover/card/selected-ref handoff DTOs.
- Call the Go internal structured query service for deterministic read-model access.
- Render user-facing text as cards/source links by default.
- Use bounded context only for explicit summary/fact extraction paths.
- Never concatenate `title + normalized_body` into `AgentResponse.answer_text`.

Provider function calling and SDK adapter should:

- Generate tools only from allowed ToolSpec agent-facing tools.
- Stop using `campus_notice_get` as the default SDK denominator.
- Either recut the pilot to `campus_notice_discover`/card resolve or close the pilot until a new denominator is admitted.
- Keep SDK default-off and Go `allowed_tools` ownership unchanged.

## Work Packages

1. Update `packages/notice-agent/src/campus_notice_agent/tool_adapter.py`.
   - Replace body answer with card/source URL rendering.
   - Add helper for consistent `NoticeCard` / `ResolvedNoticeRef` text.
2. Update `packages/notice-agent/src/campus_notice_agent/query_service.py` and HTTP adapter if selected-ref/context types change.
3. Update `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/*` provider/SDK adapter files.
   - `agents_sdk_notice_get_pilot.py` should be renamed/reframed or removed.
   - `agents_sdk_runner.py`, `agents_sdk_tool_bridge.py`, `provider_tool_runtime.py`, and `tool_function_schema.py` must consume the new ToolSpec posture.
4. Update agent dispatch and admission tests to reject stale body-get tools.
5. Update safe details and trace projection names so they describe card/resolve, not body get.

## Expected Test Updates

- `tests/agent/test_notice_agent.py`
- `tests/agent/test_notice_runtime_wiring.py`
- `tests/supervisor/provider_function_calling_suite.py`
- `tests/supervisor/provider_tool_runtime_suite.py`
- `tests/supervisor/agents_sdk_runner_suite.py`
- `tests/supervisor/agents_sdk_tool_bridge_suite.py`
- `tests/supervisor/agents_sdk_notice_get_pilot_suite.py`
- `tests/supervisor/agents_sdk_trace_projection_suite.py`
- `tests/supervisor/agents_sdk_closeout_guardrails_suite.py`

## Negative Cases

Tests must prove:

- A `CampusNoticeGetResult` or replacement result containing body-like fields cannot produce full-body `answer_text`.
- SDK/provider schema generation does not include internal context/body functions.
- SDK runtime policy fails closed when stale `campus_notice_get` is configured as a provider-loop pilot.

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.agent.test_notice_agent \
  tests.agent.test_notice_runtime_wiring \
  tests.supervisor.test_provider_function_calling \
  tests.supervisor.test_provider_tool_runtime \
  tests.supervisor.test_agents_sdk_runner \
  tests.supervisor.test_agents_sdk_tool_bridge \
  tests.supervisor.test_agents_sdk_trace_projection \
  tests.supervisor.test_agents_sdk_closeout_guardrails
uv run --all-packages ruff check apps/supervisor-agent-worker packages/notice-agent tests/supervisor tests/agent
git diff --check
```

## Exit Criteria

- Python notice-agent default output is card/link-first.
- Provider and SDK paths cannot call body-get as a top-level tool.
- Safe details remain sanitized and do not leak raw body fields.
