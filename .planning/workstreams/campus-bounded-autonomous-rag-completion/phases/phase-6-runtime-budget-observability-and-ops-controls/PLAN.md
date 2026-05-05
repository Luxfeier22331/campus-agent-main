---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Runtime Budget, Observability, And Ops Controls

## Objective

Bound autonomous RAG cost, time, turns, retrieval steps, tool calls and failure behavior in
production-facing paths.

## Dependencies

- Phase 1-5 expose the runtime fields needed for budgets and diagnostics.
- Phase 0 identifies which budgets already exist and which are missing.

## Desired End State

- RAG has deterministic max retrieval steps, replan count, context budget and stage deadline.
- Supervisor/bridge enforces allowed tool call and cancellation behavior.
- Timeout/cancel/fail-close outcomes are typed and trace-safe.
- Metrics and diagnostics explain slow runtime and slow RAGAS separately.
- Eval/judge model config preserves the user-requested `gpt-5.4` target if this phase touches it.
- Product chat runtime model config is a separate surface and must not change without explicit
  model-surface admission from Phase 0.

## Primary Code Targets

- `packages/retrieval-core/src/campus_retrieval_core/service.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_execution.py`
- `packages/retrieval-core/src/campus_retrieval_core/service_requests.py`
- `packages/rag-agent/src/campus_rag_agent/service_stage_diagnostics.py`
- `packages/rag-agent/src/campus_rag_agent/service_observability.py`
- `packages/rag-agent/src/campus_rag_agent/prompt_execution.py`
- `apps/supervisor-api/internal/execution`
- `apps/supervisor-api/internal/observability`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/cancel_flags.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_dispatch.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_openai_runner.py`
- `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/settings.py`
- `packages/evals/src/campus_evals/ragas_diagnostic_runner.py`
- `packages/evals/src/campus_evals/runtime_observability.py`
- Product chat runtime config files are not default targets. Add them only if Phase 0 explicitly
  admits a product chat model-surface change.

## Primary Test Targets

- `tests/retrieval/retrieval_service_replan_execution_suite.py`
- `tests/retrieval/retrieval_service_live_lookup_and_fail_close_suite.py`
- `tests/agent/rag_agent_agentic_runtime_contract_suite.py`
- `tests/agent/rag_agent_request_prompt_fallback_suite.py`
- `tests/supervisor/test_cancel_flags.py`
- `tests/supervisor/agents_sdk_runner_suite.py`
- `tests/api/supervisor_api_bridge_runtime_suite.py`
- `tests/api/supervisor_api_audit_suite.py`
- `tests/evals/ragas_diagnostic_runner_suite.py`
- `tests/evals/ragas_runtime_scorer_failure_suite.py`
- `tests/evals/ragas_runtime_retry_policy_suite.py`
- `tests/evals/ragas_runtime_settings_suite.py`

## TDD Plan

1. Add failing retrieval budget tests:
   - plan exceeding max steps fails closed.
   - replan beyond `max_replans` fails closed.
   - live lookup budget remains zero for default current RAG.
2. Add failing RAG stage budget tests:
   - prompt/context budget overflow produces typed no-answer/fail-close.
   - stage diagnostics include budget violation reason.
3. Add failing supervisor/bridge tests:
   - cancellation before dispatch prevents delegate execution.
   - cancellation during RAG checkpoint returns typed cancel outcome.
   - timeout returns typed fail-close envelope.
4. Add failing observability tests:
   - stage latency fields are present and non-negative.
   - raw user/source/provider payload is not in metrics or safe details.
   - RAGAS scorer timeout is classified as diagnostic overhead.
5. Add model config test if touched:
   - eval/judge model resolves to `gpt-5.4` in the relevant config path.
   - product chat runtime keeps its existing configured model unless Phase 0 explicitly admits a
     product chat model change.

## Implementation Steps

1. Inventory current budgets.
   - RetrievalPlanBudget already has max steps/replans/live lookups.
   - Agents SDK runner has max turns.
   - Supervisor has cancellation and timeout seams.
   - Identify missing enforcement rather than duplicating config.
2. Enforce retrieval/RAG budgets.
   - Fail closed on excessive steps/replans.
   - Preserve current default current-RAG no-live-lookup posture.
   - Surface budget reason in diagnostics.
3. Enforce cancellation/timeout.
   - Add checkpoint checks at planner, retrieval and synthesis seams if missing.
   - Keep hard-abort limitations documented for blocking provider calls.
4. Add observability.
   - Use low-cardinality labels and safe details.
   - Include stage latency, token/cost if already available, scorer overhead and failure class.
5. Handle model config only if this phase touches it.
   - Preserve `gpt-5.4` for eval/judge paths as requested by the user.
   - Do not change `PROMPT_RUNTIME_MODEL` / product chat runtime model incidentally.
   - Do not migrate embeddings/rerankers/provider SDKs in this phase.

## Write Set

Allowed:

- Retrieval/RAG budget and diagnostics files listed above
- Supervisor execution/observability/cancel files listed above
- Eval runtime observability files listed above
- Product chat runtime config files only with explicit Phase 0 model-surface admission
- Focused tests listed above
- Phase summary/state

Not allowed:

- Dollar-budget enforcement
- K8s/multi-instance capacity work
- Embedding/reranker/provider migration
- Incidental product chat model migration while implementing budgets or observability
- Raw payload logging

## Verification

Run focused Python tests:

```bash
uv run --all-packages python -m unittest \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.retrieval.retrieval_service_live_lookup_and_fail_close_suite \
  tests.agent.rag_agent_agentic_runtime_contract_suite \
  tests.agent.rag_agent_request_prompt_fallback_suite \
  tests.supervisor.test_cancel_flags \
  tests.supervisor.agents_sdk_runner_suite \
  tests.api.supervisor_api_bridge_runtime_suite \
  tests.api.supervisor_api_audit_suite \
  tests.evals.ragas_diagnostic_runner_suite \
  tests.evals.ragas_runtime_scorer_failure_suite \
  tests.evals.ragas_runtime_retry_policy_suite \
  tests.evals.ragas_runtime_settings_suite
```

Run Go tests if supervisor runtime changes:

```bash
cd apps/supervisor-api && go test ./internal/execution ./internal/observability ./internal/admission
```

Run lint/format:

```bash
uv run --all-packages ruff check \
  packages/retrieval-core/src/campus_retrieval_core \
  packages/rag-agent/src/campus_rag_agent \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker \
  packages/evals/src/campus_evals \
  tests/retrieval tests/agent tests/supervisor tests/api tests/evals
uv run --all-packages ruff format \
  packages/retrieval-core/src/campus_retrieval_core \
  packages/rag-agent/src/campus_rag_agent \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker \
  packages/evals/src/campus_evals \
  tests/retrieval tests/agent tests/supervisor tests/api tests/evals \
  --check
```

## Exit Criteria

- Budget violations produce typed fail-close outcomes.
- Cancellation/timeout is visible by stage where runtime can observe it.
- Metrics/traces/diagnostics remain low-cardinality and raw-payload-free.
- RAGAS slowness can be attributed to runtime or diagnostic/scorer overhead.
- Any touched eval/judge model config preserves `gpt-5.4`.
- Product chat runtime model remains unchanged unless Phase 0 explicitly admits that migration.

## Risks

- Risk: budgets already exist but are enforced in different layers.
  Mitigation: Phase 0 inventory decides owner; avoid duplicate controls.
- Risk: cancellation cannot hard-abort provider HTTP calls.
  Mitigation: document checkpoint boundary and still fail closed at next observable seam.
- Risk: metrics cardinality grows.
  Mitigation: use reason enums, stage names and counts, not raw request/source text.
