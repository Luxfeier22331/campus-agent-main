---
doc_type: phase_plan
workstream: agents-sdk-domain-agent-adapter-pilot
phase: 08-closeout-guardrails-docs
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 8: Closeout Guardrails And Docs

## Goal

Close the Agents SDK pilot workstream with durable guardrails, updated architecture/current-state
docs, and a precise reopen rule. The closeout must prevent SDK adoption from drifting into
framework-owned orchestration or query-time tool sprawl.

## Boundary Decisions

- SDK remains a domain-agent adapter substrate, not a repo-level orchestration owner.
- Go `supervisor-api` remains owner of admission, routing policy, allowed tools, fail-close
  terminal semantics, workflow policy, and finalization.
- ToolSpec remains canonical for structured tools; SDK tool descriptors are derived artifacts.
- SDK raw run/trace state remains internal/debug only.
- Future SDK tool expansion requires new denominator, ToolSpec admission, Go allowed-tools
  coverage, sanitized projection, and parity evidence.

## Implementation Plan

1. Harden source and contract guardrails.
   - Update `tests/contracts/contract_boundary_guardrails_suite.py` if needed to reject:
     - SDK-native type names in `packages/contracts`
     - raw SDK trace/state/model output keys
   - Add or extend supervisor source guards for SDK modules:
     - no hosted MCP
     - no web/file search
     - no filesystem/shell/code execution
     - no object store / collector / ingestion / index build
     - no raw SQL
   - Ensure source guards distinguish allowed isolated SDK runner imports from forbidden tool
     surfaces.

2. Update architecture docs.
   - `docs/architecture/system/execution-and-agents-architecture.md`
     - record the final posture from Phase 7.
     - clarify SDK adapter is bounded by ToolSpec + Go `allowed_tools`.
     - clarify raw SDK traces are not workflow trace truth.
   - `docs/architecture/current-architecture.md`
     - update only if Phase 7 makes SDK pilot accepted current truth.
     - otherwise leave current architecture unchanged and note experiment in workstream only.
   - `docs/architecture/target-architecture.md`
     - update only if target wording needs the SDK adapter lane as an optional substrate.

3. Update workstream state.
   - `README.md`: mark closeout posture and final status.
   - `ROADMAP.md`: mark Phase 8 completed after implementation.
   - `STATE.md`: record final selected posture and closeout evidence.
   - `.planning/WORKSTREAMS.md`: move to Completed with reopen rule after completion.

4. Add reopen rule.
   - Reopen only if:
     - SDK target/tool expansion is proposed.
     - SDK raw traces or native types leak into contracts/panel/eval/workflow trace.
     - ToolSpec / Go allowed-tools derivation is bypassed.
     - provider SDK version changes break runner/tool semantics.
     - Phase 6 parity evidence becomes stale or fails under current code.
     - product wants to promote the SDK lane beyond explicit gate.

5. Preserve default-off runtime posture.
   - No env default flip.
   - No product serving opening unless a separate rollout workstream is admitted.

## Acceptance Criteria

- All planned SDK phases have completed artifacts.
- Architecture docs reflect the selected posture without overstating merged/product truth.
- Contract and source guards prevent known SDK boundary regressions.
- Workstream registry has an explicit completed entry and reopen rule.
- Verification commands are documented and run.

## Verification

```bash
uv run --all-packages python -m unittest tests.supervisor.test_agents_sdk_notice_get_pilot tests.supervisor.test_agents_sdk_runner tests.supervisor.test_agents_sdk_tool_bridge tests.supervisor.test_agents_sdk_runtime_policy tests.supervisor.provider_tool_runtime_suite tests.evals.agents_sdk_pilot_parity_suite tests.evals.agents_sdk_posture_decision_suite tests.contracts.contract_boundary_guardrails_suite -q
uv run --all-packages ruff check apps/supervisor-agent-worker/src packages/evals/src tests/supervisor tests/evals tests/contracts/contract_boundary_guardrails_suite.py
uv run --all-packages ruff format apps/supervisor-agent-worker/src packages/evals/src tests/supervisor tests/evals tests/contracts/contract_boundary_guardrails_suite.py --check
pnpm docs:lint
pnpm decomposition:lint
git diff --check
```

## External References

- OpenAI Agents SDK integrations and observability:
  `https://developers.openai.com/api/docs/guides/agents/integrations-observability`
- OpenAI agent workflow evals:
  `https://developers.openai.com/api/docs/guides/agent-evals`
