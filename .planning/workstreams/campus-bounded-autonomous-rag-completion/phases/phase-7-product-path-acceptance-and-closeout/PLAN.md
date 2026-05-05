---
doc_type: phase_plan
status: planned
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Product Path Acceptance And Closeout

## Objective

Verify the completed campus-bounded autonomous RAG behavior through admitted product paths and close
planning/architecture truth.

## Dependencies

- Phase 1-6 are completed or explicitly deferred with no product-path risk.
- All changed tests from Phase 1-6 have focused passing evidence.
- No active blocker remains around serving-surface admission.

## Desired End State

- Public chat and relevant protected/operator paths demonstrate bounded, grounded RAG behavior.
- No new query-enabled surface is opened.
- Workstream docs reflect implemented truth.
- Reopen rule is precise and tied to actual failure classes.
- Deferred items are recorded outside this workstream if they are not required for current product
  acceptance.

## Product Paths To Verify

Use Phase 0/1-6 outputs to choose the exact commands. Expected paths:

- `app-api -> supervisor-api -> supervisor-agent-worker -> rag-agent`
- `public-chat-web` RAG answer path for admitted public knowledge scopes
- protected/operator diagnostics only where already admitted
- eval product path gate for public chat cases
- workflow trace gate for safe projection/guardrail metadata

## Readiness Checklist

- Phase summaries for Phase 0-6 are complete.
- Each changed runtime boundary has focused passing tests.
- Each changed eval gate has focused passing tests.
- Docs/planning changes pass markdown lint.
- No raw source/provider/prompt payload appears in trace/eval/panel-safe outputs.
- `fresh_news`, general web fallback and arbitrary URL fetch remain closed.

## Work Breakdown

1. Collect verification evidence.
   - Gather exact test commands from Phase 1-6 summaries.
   - Run the smallest complete focused gate first.
   - Run broader gates only if touched files justify them.
2. Run product path eval/smoke.
   - Use existing eval product path cases where possible.
   - Prefer deterministic local tests before live/staging smoke.
   - Do not invent a staging dependency if local acceptance covers changed behavior.
3. Update docs.
   - Update `README.md`, `REQUIREMENTS.md`, `ROADMAP.md` and `STATE.md`.
   - Update `.planning/WORKSTREAMS.md` status and reopen rule.
   - Update architecture docs only if implemented truth changed accepted architecture.
4. Close or defer.
   - Mark each phase complete with summary evidence.
   - Record deferred work as seeds/future workstream only when outside current scope.
   - Do not leave ambiguous "follow up later" notes in phase summaries.

## Primary Test Targets

The final set depends on actual changed files. Expected focused set:

- `tests/agent/rag_agent_agentic_runtime_contract_suite.py`
- `tests/agent/rag_agent_answer_quality_regression_suite.py`
- `tests/agent/rag_agent_answer_grounding_suite.py`
- `tests/agent/rag_agent_official_web_guardrails_suite.py`
- `tests/contracts/contract_models_runtime_and_tools_suite.py`
- `tests/contracts/contract_models_request_and_retrieval_suite.py`
- `tests/evals/ragas_diagnostic_runner_suite.py`
- `tests/evals/agentic_retrieval_plan_eval_suite.py`
- `tests/evals/workflow_trace_gate_suite.py`
- `tests/evals/multi_agent_product_path_gate_suite.py`
- `tests/api/supervisor_api_bridge_runtime_suite.py`
- `tests/supervisor/agent_dispatch_suite.py`

## Verification Plan

Run focused Python gate:

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_agentic_runtime_contract_suite \
  tests.agent.rag_agent_answer_quality_regression_suite \
  tests.agent.rag_agent_answer_grounding_suite \
  tests.agent.rag_agent_official_web_guardrails_suite \
  tests.contracts.contract_models_runtime_and_tools_suite \
  tests.contracts.contract_models_request_and_retrieval_suite \
  tests.evals.ragas_diagnostic_runner_suite \
  tests.evals.agentic_retrieval_plan_eval_suite \
  tests.evals.workflow_trace_gate_suite \
  tests.evals.multi_agent_product_path_gate_suite \
  tests.api.supervisor_api_bridge_runtime_suite \
  tests.supervisor.agent_dispatch_suite
```

Run lint/format for changed Python:

```bash
uv run --all-packages ruff check .
uv run --all-packages ruff format . --check
```

Run docs/planning checks:

```bash
pnpm docs:lint
git diff --check -- \
  .planning/workstreams/campus-bounded-autonomous-rag-completion \
  .planning/WORKSTREAMS.md \
  docs packages apps tests
```

Run JS/TS affected gates only if product/API TS files changed:

```bash
pnpm web:typecheck:affected
pnpm web:test:affected
pnpm web:build:affected
```

Run broader Python gate if changes touched shared contracts or multiple runtime layers:

```bash
uv run --all-packages python -m unittest discover -s tests -t .
```

## Documentation Updates

Always update:

- `.planning/workstreams/campus-bounded-autonomous-rag-completion/README.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/ROADMAP.md`
- `.planning/workstreams/campus-bounded-autonomous-rag-completion/STATE.md`
- `.planning/WORKSTREAMS.md`
- All phase `SUMMARY.md` files touched by implementation

Update only if implementation changes accepted truth:

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/contracts/rag-agent-retrieval-plan-contract.md`
- `docs/runbooks/eval-operations-governance.md`

## Closeout Criteria

- Workstream status is `completed`.
- Roadmap marks all completed phases.
- State records final verification commands and current posture.
- `.planning/WORKSTREAMS.md` moves the workstream to Completed with a precise reopen rule.
- No active phase summary has `pending execution`.
- No deferred item is needed for current product acceptance.

## Reopen Rule Draft

Reopen only if query-time RAG again depends on unbounded web/source fetch, loses explicit query
mode/source-trust/fail-close planning, consumes raw cross-agent context instead of bounded
projection refs, lets retrieved content alter instructions/tool policy, loses stage-level
answer-quality attribution, or production path regressions cannot be tied to planner/retrieval/
evidence/grounding/guardrail/runtime stages.

## Risks

- Risk: broad repo-wide tests are slow or blocked by unrelated failures.
  Mitigation: run focused gates first and document unrelated blockers separately.
- Risk: closeout docs overstate merged truth.
  Mitigation: describe current worktree truth unless changes are merged to `develop`.
- Risk: acceptance accidentally implies new surface opening.
  Mitigation: include explicit no-opening proof in final summary.
