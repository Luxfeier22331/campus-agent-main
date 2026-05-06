---
doc_type: phase_summary
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Boundary And Readiness Review

## Result

Phase 0 is complete. The RAG-internal Agents SDK loop may proceed as a package/worker
implementation, but only behind explicit rollout posture and without opening `retrieval.query` as a
public ToolSpec.

## Readiness Matrix

| Area | Current Fact | Required Behavior | Phase Owner | Owned Files | Owned Tests | Verification Command | Risk If Missing |
|---|---|---|---|---|---|---|---|
| Config truth | `configs/runtime/tools.v1.json` keeps `retrieval.query` as `surface=agent_internal`, `runtime_posture=closed`; `configs/runtime/agents.v1.json` gives `rag-agent` no structured handoff tools. | SDK retrieval tools stay internal to `rag-agent`; no ToolSpec or AgentSpec handoff expansion. | Phase 2 / Phase 7 | `configs/runtime/*.json` drift tests only | `tests/agent/rag_agent_sdk_boundary_suite.py` | `uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_boundary_suite -q` | Retrieval becomes an externally admitted tool and bypasses RAG ownership. |
| SDK dependency | `openai-agents>=0.14.8` is available through `apps/supervisor-agent-worker`; `packages/rag-agent` has no SDK dependency. | Official SDK imports stay in worker runner code; `rag-agent` owns SDK-neutral request/result projections. | Phase 1 / Phase 5 | `packages/rag-agent/src/campus_rag_agent/rag_sdk_*.py`, `apps/supervisor-agent-worker/src/.../rag_agents_sdk_openai_runner.py` | `tests/agent/rag_agent_sdk_contract_suite.py`, `tests/supervisor/rag_agents_sdk_openai_runner_suite.py` | SDK-native types leak into stable package contracts or make local RAG tests require provider runtime. |
| SDK conformance | Existing domain-agent SDK shell proves selected structured tool adapter shape, but not RAG structured output or internal retrieval tool behavior. | Add conformance tests for `Agent`, `Runner`, `FunctionTool`, `ModelSettings`, `RunConfig(tracing_disabled=True)` and structured output before relying on SDK APIs. | Phase 2 | `tests/supervisor/rag_agents_sdk_conformance_suite.py` | Same | `uv run --all-packages python -m unittest tests.supervisor.rag_agents_sdk_conformance_suite -q` | A locked SDK API drift becomes runtime-only failure. |
| Pipeline insertion | Current RAG path already has deterministic scope/version/preflight, planner, retrieval execution, evidence selection and grounding synthesis. | SDK loop starts only after deterministic planner/evidence selection has produced bounded supporting evidence, and before legacy prompt/deterministic synthesis. | Phase 3 | `packages/rag-agent/src/campus_rag_agent/service.py`, `service_answer_synthesis.py` | `tests/agent/rag_agent_sdk_service_suite.py` | `uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_service_suite -q` | Model loop rewrites scope or competes with deterministic planner truth. |
| Query intent | Current handbook planning can over-clarify fuzzy category/list questions. | Represent `category_discovery`, `specific_policy_lookup`, `ambiguous_procedure`, `fact_lookup`, `comparison`, `unsupported_scope` inside RAG without supervisor rewrite. | Phase 1 / Phase 3 | `rag_sdk_models.py` | `tests/agent/rag_agent_sdk_contract_suite.py`, `tests/evals/rag_agents_sdk_eval_suite.py` | Same | Fuzzy questions like scholarship lists remain blocked before retrieval. |
| Claim/span grounding | Existing grounding validates answer text against evidence, but SDK output needs explicit claim/list-item support anchors. | Accepted SDK output must cite returned source ids and at least one source/excerpt/span/ref anchor for every claim and list item. | Phase 1 / Phase 4 | `rag_sdk_output.py` | `tests/agent/rag_agent_sdk_contract_suite.py` | Same | Source-id-only citations allow unsupported generated facts. |
| Bounded replan | Existing semantic replan is retrieval-core callback driven by empty step results. | SDK may select deterministic query slots by default; semantic replan requires budget, reason and no widening of scope, selector, authz or version constraints. | Phase 2 / Phase 4 | `rag_sdk_tools.py` | `tests/agent/rag_agent_sdk_tools_suite.py` | `uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_tools_suite -q` | Model query rewrite silently widens retrieval authority. |
| Trace posture | Existing worker SDK trace projection is sanitized; native SDK tracing is disabled in the current OpenAI runner. | Keep SDK native tracing off by default. Project only schema-versioned safe fields: mode, selected tool, counts, failure class, latency, model ref, no raw prompts/transcripts/evidence. | Phase 5 / Phase 6 | `rag_sdk_trace.py`, worker runner | `tests/agent/rag_agent_sdk_trace_suite.py`, `tests/supervisor/rag_agents_sdk_openai_runner_suite.py` | Focused unittest + `pnpm docs:lint` | Raw provider or SDK trace leaks into response/eval surfaces. |
| Rollout posture | Domain-agent SDK adapters are admitted through ToolSpec posture; RAG internal loop has no posture yet. | Implement `closed`, `candidate`, `shadow`, `default_on`, `fallback_only`; begin as `candidate` for explicit injection, no silent dual primary path. | Phase 3 / Phase 8 | `rag_sdk_models.py`, `service.py`, worker delegate assembly | `tests/agent/rag_agent_sdk_service_suite.py` | Focused unittest | SDK and legacy prompt executor both act as invisible primary synthesis paths. |
| Product routing negative | `门户密码忘了怎么办` is not current RAG knowledge scope. | Keep it as unsupported/routing-negative eval sample, not a scholarship/regulation answer. | Phase 7 | eval fixtures / suite | `tests/evals/rag_agents_sdk_eval_suite.py` | Focused unittest | RAG becomes hidden fallback for service/identity workflow. |

## Frozen Decisions

- Phase 3 starts with explicit `candidate` behavior when a runner is injected; no env default silently
  flips production behavior.
- `packages/rag-agent` stays SDK-neutral. The official SDK dependency remains in
  `apps/supervisor-agent-worker`.
- `retrieval.query` remains internal and closed.
- SDK native tracing stays disabled by default.
- `fallback_only` is a compatibility posture for deterministic legacy path only; it is not a second
  long-term synthesis architecture.
- Phase 8 must either promote a single default path or demote the unused path to test/fixture support.

## Evidence

Read-only audit confirmed:

- `retrieval.query` is present only as `agent_internal` and `closed`.
- `rag-agent.allowed_structured_handoff_tools` is empty.
- Existing RAG planner and retrieval stages expose enough deterministic context to build bounded SDK
  projections without changing supervisor contracts.
- Existing worker SDK runner already disables native tracing and uses repo-owned tool execution for
  admitted structured tools.
