---
doc_type: state
workstream: agents-sdk-domain-agent-adapter-promotion
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# State: Agents SDK Domain-Agent Adapter Promotion

## Current Position

**Status:** Implementation complete, explicit-gated candidate only
**Current Phase:** Closeout verification
**Last Activity:** 2026-05-04
**Last Activity Description:** Implemented the selected SDK adapter promotion slice for
`notice-agent + campus_notice_discover`, kept `campus_notice_get` closed, added target/tool
readiness matrix output, and added eval gate evidence that keeps the lane explicit-gated until real
latency/cost smoke evidence exists.

## Baseline Facts

- `openai-agents>=0.14.8` is already a worker dependency.
- `SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED` defaults off.
- `_build_agents_sdk_runner` is target-agnostic and only builds the OpenAI Agents SDK runner after
  explicit runtime gate, selected target/tool allowlist, provider, model and API key are configured.
- `campus_notice_get` is `agent_internal` with `runtime_posture=closed`.
- `campus_notice_discover` is the first live read-only agent-facing notice ToolSpec candidate with
  `runtime_posture=sdk_adapter_candidate`.
- Go `supervisor-api` remains AgentSpec / ToolSpec / WorkflowPlan / finalizer owner.

## Current Blockers

- No code blocker for explicit-gated candidate.
- Default-on promotion remains blocked until real SDK smoke records live latency/cost/error
  evidence.

## Next Step

Run closeout verification and decide whether to mark this workstream completed with
`keep_explicit_gate` posture.

## Verification

Current targeted verification:

```bash
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_tool_bridge_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agents_sdk_runtime_policy_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.agents_sdk_notice_get_pilot_suite tests.evals.agents_sdk_promotion_gate_suite -q
go test ./internal/runtimepolicy
pnpm docs:lint
git diff --check -- .planning/workstreams/agents-sdk-domain-agent-adapter-promotion apps/supervisor-agent-worker/src/campus_supervisor_agent_worker apps/supervisor-api/internal/runtimepolicy configs/runtime/tools.v1.json packages/evals/src/campus_evals tests/supervisor tests/evals docs/contracts/campus-notice-runtime-contract.md docs/architecture/system/execution-and-agents-architecture.md
```

## Continuity Notes

- This workstream is about SDK adapter promotion, not repo-wide supervisor replacement.
- It must preserve `supervisor-multi-agent-runtime-contract-hardening` boundaries.
- It must not interfere with active `agentic-rag-runtime-rearchitecture`.
- Default-on runtime promotion is not allowed before Phase 6-8 evidence.
