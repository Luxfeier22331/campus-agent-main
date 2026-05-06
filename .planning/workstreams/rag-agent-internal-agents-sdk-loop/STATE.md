---
doc_type: state
workstream: rag-agent-internal-agents-sdk-loop
status: completed
created: 2026-05-05
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# State: RAG Agent Internal Agents SDK Loop

## Current Position

**Status:** Completed
**Current Phase:** Complete
**Last Activity:** 2026-05-06
**Last Activity Description:** Updated acceptance record after Python SDK fixture/contract drift
recheck and recorded follow-up expansion lanes. The default path remains deterministic RAG unless
worker injects the SDK runner in `candidate`; `shadow` is observation-only, `default_on` is
implemented but not enabled by default, and `fallback_only`/`closed` preserve the legacy path.

## Baseline Facts

- `openai-agents>=0.14.8` is already available through the worker dependency path used by
  completed SDK adapter promotion.
- Existing SDK adapter promotion covers ToolSpec-admitted read-only structured tools; it does not
  cover RAG-internal retrieval.
- `rag-agent` is active/open in AgentSpec but currently has no structured handoff tools.
- `retrieval.query` is internal/closed and must remain absent from public ToolSpec admission.
- Current RAG pipeline already performs deterministic scope/version/preflight, retrieval plan
  construction, retrieval execution, evidence selection and grounded answer synthesis.
- Current worker SDK runner shell already demonstrates the repo pattern: official SDK under a
  bounded adapter, repo-owned tool execution, sanitized projection, Go finalization.
- Supervisor routing does not rewrite or expand knowledge queries; `rag-agent` owns query framing
  after admission.
- Current handbook query planning over-clarifies generic `奖学金` questions when the user is asking
  for category discovery or a list of available policies.
- `门户密码忘了怎么办` is a service/identity routing-negative sample for current RAG, not a
  regulation/student-rules knowledge answer.
- Workstream-level ROADMAP is GSD-readable, and Phase 0 now has local GSD artifacts:
  `CONTEXT.md`, `RESEARCH.md` and `PLAN.md`.
- Phase 0 must finish before implementation starts; it owns the readiness matrix and does not edit
  runtime code.

## Current Slice

Completed slice:

- SDK-neutral `rag-agent` request/output/tool/trace projections.
- Claim/span and list-item guardrails.
- Bounded `retrieve_evidence` tool projection.
- Candidate/default-on service integration with fail-closed semantics.
- Shadow mode that executes SDK but returns deterministic legacy response.
- Worker-owned official OpenAI Agents SDK runner plus mock runner.
- Focused eval cases for scholarship category discovery and portal-password routing negative.
- Public-chat-style Go finalizer coverage for SDK-completed RAG responses and raw result
  diagnostics rejection.
- `default_on` rollout coverage plus sanitized RAG SDK trace projection carried through
  `AgentObservability.safe_details`, with unsafe projection fail-closed.
- Architecture docs updated for RAG-internal SDK lane.

Latest acceptance addendum, 2026-05-06:

- Python SDK fixture/contract drift was rechecked with focused suites. The previously observed
  `EvidenceSource.__init__() got unexpected keyword argument 'semantic_role'` failure is not
  present in the current worktree; `EvidenceSource` now carries `semantic_role`, `polarity`,
  `action_type` and `claim_type`, and the focused SDK suites pass.
- Local public-chat real-provider E2E harness now targets the product path and asserts
  `prompt_runtime_state=rag_sdk_completed`.
- Real-provider/public-chat E2E execution is still not accepted because the current WSL Docker
  backend returns Docker process failures (`SIGBUS` / daemon 500 class), so this remains an
  environment blocker rather than SDK loop contract evidence.
- Follow-up SDK expansion planning is captured in `EXPANSION-PLAN.md`; it does not reopen this
  completed workstream.

## Blockers

- Existing dirty worktree includes unrelated RAG and app-api changes from other workstreams; this
  closeout must not revert or claim those changes.
- Real-provider public-chat E2E requires a healthy local Docker backend for supervisor runtime
  restart. Current WSL Docker failure blocks that acceptance lane.

## Reopen Rule

Reopen only if `retrieval.query` becomes public/structured handoff, SDK-native types leak into
`packages/contracts`, SDK output can complete without claim/span evidence support, SDK tool input
can widen scope/authz/version selectors, shadow/fallback modes affect user-facing answers, raw SDK
trace/provider payload reaches shared response/eval surfaces, or RAG SDK category discovery regresses
to premature clarification.

## Verification Targets

Planning verification:

```bash
pnpm docs:lint
git diff --check -- .planning/workstreams/rag-agent-internal-agents-sdk-loop .planning/WORKSTREAMS.md
```

Implementation verification, once phases begin:

```bash
uv run --all-packages python -m unittest tests.rag_agent -q
uv run --all-packages python -m unittest tests.supervisor -q
uv run --all-packages python -m unittest tests.evals -q
uv run --all-packages ruff check packages/rag-agent apps/supervisor-agent-worker tests
uv run --all-packages ruff format packages/rag-agent apps/supervisor-agent-worker tests --check
pnpm docs:lint
```

## Next Step

Workstream complete. Next work belongs to broader product-path E2E, real-provider smoke or one of
the explicit expansion lanes in `EXPANSION-PLAN.md`, not to this closed implementation workstream.

## Closeout Verification

Focused workstream checks:

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_contract_suite tests.agent.rag_agent_sdk_tools_suite tests.agent.rag_agent_sdk_service_suite tests.agent.rag_agent_sdk_boundary_suite tests.agent.rag_agent_sdk_trace_suite tests.agent.rag_agent_sdk_rollout_suite tests.supervisor.rag_agents_sdk_openai_runner_suite tests.supervisor.rag_agents_sdk_delegate_suite tests.supervisor.rag_agents_sdk_conformance_suite tests.evals.rag_agents_sdk_eval_suite -q
go test ./internal/httpapi -count=1
uv run --all-packages ruff check packages/rag-agent/src/campus_rag_agent/rag_sdk_models.py packages/rag-agent/src/campus_rag_agent/rag_sdk_output.py packages/rag-agent/src/campus_rag_agent/rag_sdk_service.py packages/rag-agent/src/campus_rag_agent/rag_sdk_tools.py packages/rag-agent/src/campus_rag_agent/rag_sdk_trace.py packages/rag-agent/src/campus_rag_agent/service_observability.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_openai_runner.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_mock_runner.py tests/agent/rag_agent_sdk_contract_suite.py tests/agent/rag_agent_sdk_tools_suite.py tests/agent/rag_agent_sdk_service_suite.py tests/agent/rag_agent_sdk_boundary_suite.py tests/agent/rag_agent_sdk_trace_suite.py tests/agent/rag_agent_sdk_rollout_suite.py tests/supervisor/rag_agents_sdk_openai_runner_suite.py tests/supervisor/rag_agents_sdk_delegate_suite.py tests/supervisor/rag_agents_sdk_conformance_suite.py tests/evals/rag_agents_sdk_eval_suite.py
uv run --all-packages ruff format packages/rag-agent/src/campus_rag_agent/rag_sdk_models.py packages/rag-agent/src/campus_rag_agent/rag_sdk_output.py packages/rag-agent/src/campus_rag_agent/rag_sdk_service.py packages/rag-agent/src/campus_rag_agent/rag_sdk_tools.py packages/rag-agent/src/campus_rag_agent/rag_sdk_trace.py packages/rag-agent/src/campus_rag_agent/service_observability.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_openai_runner.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_mock_runner.py tests/agent/rag_agent_sdk_contract_suite.py tests/agent/rag_agent_sdk_tools_suite.py tests/agent/rag_agent_sdk_service_suite.py tests/agent/rag_agent_sdk_boundary_suite.py tests/agent/rag_agent_sdk_trace_suite.py tests/agent/rag_agent_sdk_rollout_suite.py tests/supervisor/rag_agents_sdk_openai_runner_suite.py tests/supervisor/rag_agents_sdk_delegate_suite.py tests/supervisor/rag_agents_sdk_conformance_suite.py tests/evals/rag_agents_sdk_eval_suite.py --check
pnpm docs:lint
git diff --check -- .planning/workstreams/rag-agent-internal-agents-sdk-loop .planning/WORKSTREAMS.md docs/architecture/system/agentic-retrieval-architecture.md docs/architecture/system/execution-and-agents-architecture.md packages/rag-agent/src/campus_rag_agent/rag_sdk_models.py packages/rag-agent/src/campus_rag_agent/rag_sdk_output.py packages/rag-agent/src/campus_rag_agent/rag_sdk_service.py packages/rag-agent/src/campus_rag_agent/rag_sdk_tools.py packages/rag-agent/src/campus_rag_agent/rag_sdk_trace.py packages/rag-agent/src/campus_rag_agent/service_observability.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_openai_runner.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/rag_agents_sdk_mock_runner.py apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agent_delegates.py apps/supervisor-api/internal/httpapi/finalizer.go apps/supervisor-api/internal/httpapi/finalizer_test.go tests/agent/rag_agent_sdk_contract_suite.py tests/agent/rag_agent_sdk_tools_suite.py tests/agent/rag_agent_sdk_service_suite.py tests/agent/rag_agent_sdk_boundary_suite.py tests/agent/rag_agent_sdk_trace_suite.py tests/agent/rag_agent_sdk_rollout_suite.py tests/supervisor/rag_agents_sdk_openai_runner_suite.py tests/supervisor/rag_agents_sdk_delegate_suite.py tests/supervisor/rag_agents_sdk_conformance_suite.py tests/evals/rag_agents_sdk_eval_suite.py
gsd-sdk query workstream.status rag-agent-internal-agents-sdk-loop --raw --cwd "$PWD"
```

Latest focused evidence:

- Python SDK suites: `Ran 31 tests ... OK`
- Go supervisor-api `internal/httpapi`: `ok`
- Ruff check: `All checks passed!`
- Ruff format: `18 files already formatted`
- Docs lint: `Summary: 0 error(s)`
- Diff whitespace: clean
- GSD status: `Completed`

Fresh drift-check evidence, 2026-05-06:

```bash
uv run --all-packages python -m unittest tests.agent.rag_agent_sdk_tools_suite tests.agent.rag_agent_sdk_service_suite tests.agent.rag_agent_sdk_rollout_suite tests.supervisor.rag_agents_sdk_delegate_suite tests.supervisor.rag_agents_sdk_openai_runner_suite -q
```

Observed result:

- `Ran 24 tests in 0.031s`
- `OK`
