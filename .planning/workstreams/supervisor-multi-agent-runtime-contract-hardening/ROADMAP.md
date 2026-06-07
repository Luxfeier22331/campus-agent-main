---
doc_type: roadmap
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Supervisor Multi-Agent Runtime Contract Hardening

## Phase Status

- [x] **Phase 0: Architecture And Workstream Admission** — update architecture docs and create native workstream.
- [x] **Phase 1A: AgentSpec Registry Base** — registry artifact, Go/Python loaders, inventory and drift tests landed.
- [x] **Phase 1B: AgentSpec Runtime Admission** — Go planner validation and Python dispatch fail-close now enforce active/open agent payload boundaries.
- [x] **Phase 2A: Agent Invocation Graph Base** — `AgentInvocation` projection, workflow trace/store invariants and contract wiring landed.
- [x] **Phase 2B: Invocation Edge Semantics** — multi-step invocations now carry parent edges and consumed projection refs.
- [x] **Phase 3: Context Projection Policy** — projection taxonomy, `workflow_context` wire envelope, required-projection fail-close and raw-context guards landed.
- [x] **Phase 4: Tool Result Provenance Contract** — bounded tool summary provenance, source/ref hash and fail-close reason gates landed.
- [x] **Phase 5A: Runtime Wiring Base Slice** — first executable wiring slice landed in Go planner/store, Python bridge and generated contracts.
- [x] **Phase 5B: Runtime Wiring Readiness Plan** — contract hardening is complete; future runtime expansion remains deferred under governed multi-agent runtime.
- [x] **Phase 6A: Eval Denominator Base Gate** — workflow trace eval gates invocation target alignment, parent edges and projection refs.
- [x] **Phase 6B: Eval Denominator Expansion** — trace gate now catches raw context leaks, projection summary gaps, unbounded tool summaries and missing provenance.
- [x] **Phase 7: Observability Plan** — workflow / invocation / tool / projection / provider correlation ids and redaction policy documented.
- [x] **Phase 8: Implementation Readiness Review** — contract hardening closeout completed; no new product capability opened.

## Phase 0: Architecture And Workstream Admission

**Status:** completed

**Goal:** update repo architecture truth and create native planning entry.

**Deliverables:**

- `docs/architecture/system/execution-and-agents-architecture.md` updated with `AgentSpec`,
  `AgentInvocationGraph` and context projection policy.
- `docs/architecture/target-architecture.md` updated with target-level lifecycle and registry
  constraints.
- Native workstream directory with README, requirements, roadmap and state.
- Registry entry in `.planning/WORKSTREAMS.md`.

**Verification:**

```bash
pnpm docs:lint
git diff --check
```

## Phase 1: AgentSpec Contract Design

**Goal:** make agent registry a first-class contract.

**Deliverables:**

- Proposed `AgentSpec` schema and versioning policy.
- Candidate artifact path:
  - `configs/runtime/agents.v1.json`
  - `configs/runtime/agents.schema.v1.json` or repo-equivalent schema validation path
- Initial inventory for `rag-agent`, `campus-services-agent`, `notice-agent` and
  `navigation-agent`.
- Derivation/drift rules for Go planner, Python delegate map, contracts and eval.
- Test plan for:
  - schema validity
  - duplicate/unknown agent id rejection
  - Go planner target coverage
  - Python delegate map coverage
  - ToolSpec allowed-tools compatibility

**Exit Criteria:**

- No new stable agent can be opened without a registry entry.
- Planner/delegate drift has a concrete test path.
- Phase 1 freezes the canonical artifact path; after this point `AgentSpec or equivalent artifact`
  is no longer acceptable wording.

## Phase 2: Agent Invocation Graph Schema

**Goal:** define the canonical runtime graph projection.

**Deliverables:**

- `AgentInvocation` DTO / schema proposal.
- Candidate contract location decision:
  - `docs/contracts/schemas/supervisor-execution.openapi.yaml` if operator-visible
  - `packages/contracts/src/campus_contracts/models_runtime.py` only if it belongs in shared
    stable response/runtime models
  - Go-internal execution schema if it remains private run-state only
- `WorkflowRunStore` extension plan for invocation edges, statuses and projection refs.
- Mapping from existing `workflow_trace_summary` to graph projection.
- Example fixtures for single-step and current gated multi-step:
  - `tests/fixtures/supervisor_execution_contract/*`
  - `tests/fixtures/workflow_trace/*` or repo-equivalent eval fixture path

**Exit Criteria:**

- Graph represents current `single_step` and selected-notice + RAG `multi_step`.
- Raw provider/native trace remains excluded by schema.
- Store/OpenAPI/shared-contract boundary is explicitly decided before implementation.

## Phase 3: Context Projection Policy

**Status:** completed

**Goal:** prevent raw history/evidence leakage across agents.

**Deliverables:**

- Per-agent context filter matrix.
- Projection kind taxonomy, including `notice_context`, `schedule_baseline`,
  `service_guide_facts`, `place_context`, `evidence_bundle` and `grounding_verdict`.
- Required/optional projection rules and fail-close behavior.
- Tests/gates plan for missing, oversized, visibility-mismatched and raw-leak projections.
- Candidate fixture paths:
  - `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`
  - `tests/evals/*workflow_trace*`
  - contract fixtures if projection fields become execution-wire visible

**Exit Criteria:**

- Every multi-step edge declares allowed and required projection kinds.
- Missing required projection cannot silently fall back to prompt history.
- Raw-leak detection names the exact guardrail tests or fixtures that will fail.

**Delivered:**

- Canonical projection taxonomy is represented in the OpenAPI schema and generated TS / Go /
  Python contract artifacts.
- `AgentRequest.workflow_context` is the cross-agent execution-wire projection envelope.
- Go bridge payload construction fails closed when a required projection is missing.
- Python bridge parses `workflow_context` into the shared contract model and rejects raw
  projection keys.
- Contract and fixture tests cover valid projection refs and raw context rejection.

## Phase 4: Tool Result Provenance Contract

**Status:** completed

**Goal:** align tool outputs with multi-agent trace and finalizer requirements.

**Deliverables:**

- Tool result minimum fields: typed payload, source refs/title/url, freshness/effective window,
  business outcome, fail-close reason, result hash and trace-safe summary.
- Deterministic query function vs agent-facing tool boundary examples.
- Update plan for campus-services, notice and retrieval tool result adapters.
- Candidate touchpoints:
  - `configs/runtime/tools.v1.json`
  - `docs/contracts/*-lookup-contract.md`
  - `packages/contracts/src/campus_contracts/models_tools.py`
  - `apps/supervisor-api/internal/structuredquery`
  - `packages/campus-services-agent` / `packages/notice-agent` thin adapters

**Exit Criteria:**

- Tool result projection is sufficient for finalizer, eval and operator-safe trace.
- Raw body/blob/source dump remains unavailable to agent-visible tool output.
- Each existing opened tool family has either a compliant result projection or a named follow-up
  implementation task.

**Delivered:**

- Workflow trace eval requires bounded tool summaries.
- Tool summaries must include source refs or result hash unless they fail closed.
- Fail-close tool summaries must include reason.
- Tool trace source id extraction accepts both JSON array shapes used by runtime summaries.

## Phase 5A: Runtime Wiring Base Slice

**Status:** completed

**Goal:** land the first executable wiring slice without treating the whole runtime wiring plan as
closed.

**Delivered:**

- Go `WorkflowPlan.allowed_agents` projection.
- Go `AgentSpec` planner validation.
- Python dispatch `AgentSpec` admission fail-close.
- `AgentInvocation` persistence and trace projection for single-step and current gated
  multi-step.

## Phase 5B: Runtime Wiring Readiness Plan

**Status:** completed

**Goal:** convert contracts into implementation work packages.

**Deliverables:**

- Go planner/store implementation tasks.
- Python worker/delegate implementation tasks.
- `packages/contracts` / OpenAPI boundary decision.
- Migration strategy for existing workflow trace and tests.

**Exit Criteria:**

- Implementation can proceed without cross-package ownership ambiguity.

**Delivered:**

- Contract-hardening scope is now closed in this workstream.
- Future runtime implementation breadth, including broader resumable/retry/replan workflow
  execution, remains outside this workstream and belongs to deferred
  `governed-multi-agent-workflow-runtime` or a narrower successor workstream.
- Existing implementation wiring covers the current gated selected-notice + RAG two-step path
  without opening new product capability.

## Phase 6A: Eval Denominator Base Gate

**Status:** completed

**Goal:** make the initial invocation graph contract testable.

**Delivered:**

- `single_step` / `multi_step` traces must include `agent_invocations`.
- Invocation target order must align with the handoff chain.
- Multi-step invocation nodes must carry parent edges.
- Downstream invocations must reference consumed context projection ids where projections exist.

## Phase 6B: Eval Denominator Expansion

**Status:** completed

**Goal:** make orchestration correctness a release gate.

**Deliverables:**

- Workflow trace eval case taxonomy.
- Fixtures for terminal/single_step/multi_step.
- Cases for wrong handoff, overbroad allowed tools, raw context leak, missing projection,
  ungrounded finalizer and fail-close provenance.

**Exit Criteria:**

- Eval plan catches medium-and-above multi-agent architecture regressions.

**Delivered:**

- Workflow trace gate already validates invocation presence, target order, parent edges and
  consumed projection refs.
- The expanded gate adds raw context leak, missing projection summary field, unbounded tool
  summary, missing source/ref hash and missing fail-close reason checks.
- Contract fixture matrix now carries required `allowed_agents`, `workflow_context` and
  `agent_invocations` fields where relevant.

## Phase 7: Observability Plan

**Status:** completed

**Goal:** make graph lifecycle observable without sensitive payload leakage.

**Deliverables:**

- OTel/log/audit correlation ids and low-cardinality labels.
- Mapping for request id, workflow run id, agent invocation id, tool call id, projection id and
  evidence refs.
- Failure fingerprint and cost/latency/token summary policy.

**Exit Criteria:**

- Operator/debug observability can reconstruct workflow shape without raw prompts or source bodies.

**Delivered:**

- Architecture now maps request/trace, workflow run, agent invocation, tool call, projection,
  source/evidence and provider auxiliary ids.
- Raw prompts, provider responses, source bodies and object bytes remain excluded from OTel span
  attributes, audit events, workflow trace, panel and eval canonical assets.

## Phase 8: Implementation Readiness Review

**Status:** completed

**Goal:** close planning and split executable phases.

**Deliverables:**

- Readiness checklist.
- Risks and blockers.
- Ordered implementation backlog with tests and verification commands.
- Decision whether to keep this workstream for execution or split implementation into narrower
  workstreams.

**Delivered:**

- Readiness review result: `supervisor-multi-agent-runtime-contract-hardening` is complete as a
  contract-hardening workstream.
- No new product runtime path was opened.
- Reopen only for contract drift; product workflow expansion should start from the deferred
  `governed-multi-agent-workflow-runtime` readiness matrix.
