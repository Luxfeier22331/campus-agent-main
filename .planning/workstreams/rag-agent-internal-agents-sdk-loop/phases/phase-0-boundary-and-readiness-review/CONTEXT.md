---
doc_type: context
status: ready_for_planning
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Context: Boundary And Readiness Review

## Phase Boundary

Phase 0 is a planning and audit phase. It prepares implementation by freezing the `rag-agent`
internal Agents SDK loop boundary, SDK conformance requirements, rollout posture, grounding
requirements and observability posture.

It does not edit runtime code.

## Locked Decisions

- Use the official OpenAI Agents SDK. Do not implement or fork an SDK.
- SDK adoption is internal to `rag-agent`; it is not a repo-wide supervisor runtime replacement.
- `retrieval.query` remains internal/closed and must not become public ToolSpec,
  provider-function tool or SDK-admitted structured handoff surface.
- Go `supervisor-api` remains owner of admission, routing, workflow planning and finalization.
- `packages/retrieval-core` remains owner of retrieval kernel behavior.
- `packages/contracts` must not import SDK-native types.
- SDK native tracing is off by default. Phase 0 must define sanitized projection requirements
  before any later phase uses SDK traces or hooks.
- Accepted answers require claim/list-item support anchored to returned evidence spans or excerpts,
  not just source-id presence.
- SDK query behavior is bounded. Default behavior is selecting deterministic planner query slots;
  semantic replan requires an explicit budget, reason, trace and no-scope-widening rules.
- Runtime posture must be frozen before service integration; rejected historical modes include
  `candidate`, `shadow`, `fallback_only` and dual-primary execution.
- Existing fuzzy real-user category discovery cases are in scope for planning:
  `有哪些本科生可以申请的奖学金` should not be forced into clarification if admitted category
  evidence exists.
- `门户密码忘了怎么办` is a routing-negative sample for current RAG and must not be answered by this
  workstream as student-rules knowledge.

## Canonical References

### Workstream

- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/README.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/REQUIREMENTS.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/ROADMAP.md`
- `.planning/workstreams/rag-agent-internal-agents-sdk-loop/STATE.md`

### Architecture

- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/current-architecture.md`

### Related Completed Workstreams

- `.planning/workstreams/agents-sdk-domain-agent-adapter-promotion/README.md`
- `.planning/workstreams/agents-sdk-domain-agent-adapter-promotion/STATE.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/README.md`
- `.planning/workstreams/agentic-rag-runtime-rearchitecture/ROADMAP.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/README.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/ROADMAP.md`

### Code References To Audit

- `configs/runtime/tools.v1.json`
- `configs/runtime/agents.v1.json`
- `packages/rag-agent/src/campus_rag_agent/service.py`
- `packages/rag-agent/src/campus_rag_agent/service_pipeline.py`
- `packages/rag-agent/src/campus_rag_agent/service_planner_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_retrieval_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_evidence_stage.py`
- `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`
- `packages/rag-agent/src/campus_rag_agent/grounding_validation.py`
- `packages/rag-agent/src/campus_rag_agent/semantic_replan.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_openai_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py`

## Output Required

Phase 0 must produce `SUMMARY.md` with:

- current config truth,
- SDK API conformance checklist,
- RAG pipeline insertion map,
- query-intent and category-discovery boundary,
- claim/span grounding readiness map,
- bounded replan readiness map,
- native-trace default-off / sanitized projection posture,
- rollout mode matrix,
- Phase 1-8 implementation readiness matrix.
