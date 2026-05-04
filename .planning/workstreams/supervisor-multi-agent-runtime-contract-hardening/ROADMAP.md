---
doc_type: roadmap
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Supervisor Multi-Agent Runtime Contract Hardening

## Phase Status

- [x] **Phase 0: Architecture And Workstream Admission** — update architecture docs and create native workstream.
- [ ] **Phase 1: AgentSpec Contract Design** — define registry schema, owner split, derivation/drift rules and initial agent inventory.
- [ ] **Phase 2: Agent Invocation Graph Schema** — define `AgentInvocation` projection and workflow trace/store invariants.
- [ ] **Phase 3: Context Projection Policy** — formalize per-agent context filters, projection kinds, visibility and fail-close behavior.
- [ ] **Phase 4: Tool Result Provenance Contract** — align agent-facing tool outputs with typed payload/source refs/freshness/display policy.
- [ ] **Phase 5: Runtime Wiring Plan** — map Go planner, WorkflowRunStore, Python worker delegate map and contracts changes into implementation tasks.
- [ ] **Phase 6: Eval Denominator Plan** — add workflow trace cases for handoff, context, tool, finalization and fail-close correctness.
- [ ] **Phase 7: Observability Plan** — define OTel/log/audit correlation for workflow, agent invocation, tool call and projection ids.
- [ ] **Phase 8: Implementation Readiness Review** — verify plan completeness, risks, test lanes and split into executable implementation phases.

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
- Initial inventory for `rag-agent`, `campus-services-agent`, `notice-agent` and
  `navigation-agent`.
- Derivation/drift rules for Go planner, Python delegate map, contracts and eval.
- Decision on artifact location, likely `configs/runtime/agents.v1.json` plus schema tests.

**Exit Criteria:**

- No new stable agent can be opened without a registry entry.
- Planner/delegate drift has a concrete test path.

## Phase 2: Agent Invocation Graph Schema

**Goal:** define the canonical runtime graph projection.

**Deliverables:**

- `AgentInvocation` DTO / schema proposal.
- `WorkflowRunStore` extension plan for invocation edges, statuses and projection refs.
- Mapping from existing `workflow_trace_summary` to graph projection.
- Single-handoff and current gated multi-step example artifacts.

**Exit Criteria:**

- Graph represents current `single_handoff` and selected-notice + RAG `multi_step`.
- Raw provider/native trace remains excluded by schema.

## Phase 3: Context Projection Policy

**Goal:** prevent raw history/evidence leakage across agents.

**Deliverables:**

- Per-agent context filter matrix.
- Projection kind taxonomy, including `notice_context`, `schedule_baseline`,
  `service_guide_facts`, `place_context`, `evidence_bundle` and `grounding_verdict`.
- Required/optional projection rules and fail-close behavior.
- Tests/gates plan for missing, oversized, visibility-mismatched and raw-leak projections.

**Exit Criteria:**

- Every multi-step edge declares allowed and required projection kinds.
- Missing required projection cannot silently fall back to prompt history.

## Phase 4: Tool Result Provenance Contract

**Goal:** align tool outputs with multi-agent trace and finalizer requirements.

**Deliverables:**

- Tool result minimum fields: typed payload, source refs/title/url, freshness/effective window,
  business outcome, fail-close reason, result hash and trace-safe summary.
- Deterministic query function vs agent-facing tool boundary examples.
- Update plan for campus-services, notice and retrieval tool result adapters.

**Exit Criteria:**

- Tool result projection is sufficient for finalizer, eval and operator-safe trace.
- Raw body/blob/source dump remains unavailable to agent-visible tool output.

## Phase 5: Runtime Wiring Plan

**Goal:** convert contracts into implementation work packages.

**Deliverables:**

- Go planner/store implementation tasks.
- Python worker/delegate implementation tasks.
- `packages/contracts` / OpenAPI boundary decision.
- Migration strategy for existing workflow trace and tests.

**Exit Criteria:**

- Implementation can proceed without cross-package ownership ambiguity.

## Phase 6: Eval Denominator Plan

**Goal:** make orchestration correctness a release gate.

**Deliverables:**

- Workflow trace eval case taxonomy.
- Fixtures for terminal/direct_runtime/single_handoff/multi_step.
- Cases for wrong handoff, overbroad allowed tools, raw context leak, missing projection,
  ungrounded finalizer and fail-close provenance.

**Exit Criteria:**

- Eval plan catches medium-and-above multi-agent architecture regressions.

## Phase 7: Observability Plan

**Goal:** make graph lifecycle observable without sensitive payload leakage.

**Deliverables:**

- OTel/log/audit correlation ids and low-cardinality labels.
- Mapping for request id, workflow run id, agent invocation id, tool call id, projection id and
  evidence refs.
- Failure fingerprint and cost/latency/token summary policy.

**Exit Criteria:**

- Operator/debug observability can reconstruct workflow shape without raw prompts or source bodies.

## Phase 8: Implementation Readiness Review

**Goal:** close planning and split executable phases.

**Deliverables:**

- Readiness checklist.
- Risks and blockers.
- Ordered implementation backlog with tests and verification commands.
- Decision whether to keep this workstream for execution or split implementation into narrower
  workstreams.

