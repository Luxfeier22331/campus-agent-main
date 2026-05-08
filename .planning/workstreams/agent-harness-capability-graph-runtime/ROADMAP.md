---
doc_type: roadmap
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Agent Harness Capability Graph Runtime

## Phase Status

- [x] **Phase 0: Boundary And Current Truth Freeze** — completed; design truth and workstream boundary recorded in `CURRENT-TRUTH-AND-DESIGN-REVIEW.md`.
- [x] **Phase 1: Artifact Ontology And Projection Contract** — completed; `workflow-artifacts.v1.json`, `ARTIFACT-ONTOLOGY.md` and focused tests freeze the initial artifact vocabulary.
- [x] **Phase 2: AgentSpec / ToolSpec Capability Graph Extension** — completed; runtime artifact registry now carries capability bindings, aliases, opening gates, priorities and eval denominator metadata, with Go/Python drift guards and `CAPABILITY-GRAPH.md`.
- [x] **Phase 3: CapabilityPlan Contract And Planner Output** — planner now emits internal `CapabilityPlan` artifact requirements for selected-notice knowledge follow-through.
- [x] **Phase 4: Resolver And WorkflowPlan Compilation** — `CapabilityPlan` now compiles into resolver-backed `WorkflowPlan` with stable fail-close resolution.
- [x] **Phase 5: Workflow Runner Artifact Validation** — runner now validates expected step artifacts, fails closed on `artifact_incomplete`, and completes workflow runs on terminal artifact/runtime failure paths.
- [x] **Phase 6: Step-Local Agents SDK Harness Alignment** — `WorkflowAgentContextWire`, generated contracts, bridge parser, bridge payload and SDK runner now carry expected output artifacts and fail closed on missing repo-owned output projections.
- [x] **Phase 7: Selected Notice Follow-Through Migration** — completed; selected-notice planning now emits capability-only multi-step preplan and relies on resolver-generated workflow shape.
- [x] **Phase 8: Transport Baseline + Notice Override Expansion Plan** — moved out as dedicated follow-up `transport-notice-override-harness-admission`; no longer blocks generic harness runtime closeout.
- [x] **Phase 9: Eval, Observability And Closeout** — completed for current runtime; trace/eval/docs closeout now proves bounded final answer artifact usage and records residual gap in `GAP-LEDGER.md`.

## Phase 0: Boundary And Current Truth Freeze

**Status:** completed

**Goal:** freeze this workstream as agent harness / capability graph work, not broad SDK orchestration
or new product surface opening.

**Deliverables:**

- `README.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `READINESS-MATRIX.md`, `STATE.md`.
- External design summary for Agents SDK manager-style orchestration, guardrails, tracing and
  agent evals.
- Repo boundary summary mapping this workstream to existing completed workstreams.
- Explicit non-goals for global LLM tool choice, SDK-owned graph and state-changing actions.

**Exit Criteria:**

- The workstream can be executed without reopening completed governed pilot or SDK promotion lines.
- The first migration target and first expansion target are explicit.
- Registry entry points to this native workstream.

**Execution Evidence:**

- `CURRENT-TRUTH-AND-DESIGN-REVIEW.md`
- `README.md`
- `REQUIREMENTS.md`
- `READINESS-MATRIX.md`
- `.planning/WORKSTREAMS.md`

## Phase 1: Artifact Ontology And Projection Contract

**Status:** completed

**Goal:** define the typed artifacts that harness can reason about before changing planner/runtime.

**Tasks:**

- Create `ARTIFACT-ONTOLOGY.md`.
- Create `configs/runtime/workflow-artifacts.v1.json`.
- Define first artifact kinds:
  - `NoticeContext`
  - `NoticeChangeSet`
  - `ScheduleBaseline`
  - `ServiceStatusFacts`
  - `ServiceGuideFacts`
  - `ContactDirectoryFacts`
  - `AcademicCalendarFacts`
  - `PlaceContext`
  - `EvidenceBundle`
  - `GroundingVerdict`
- Define each artifact's owner, visibility, source refs, freshness posture, answer eligibility and
  forbidden raw keys.
- Decide private runtime schema location for artifact metadata.
- Add contract tests or fixture snapshots for artifact kind names and forbidden raw leakage.

**Exit Criteria:**

- Artifact names and semantics are stable enough for registry and planner work.
- Existing `StepOutputProjection` can carry artifact refs without shared contract churn unless a
  deliberate promotion is required.

**Execution Evidence:**

- `configs/runtime/workflow-artifacts.v1.json`
- `ARTIFACT-ONTOLOGY.md`
- `tests/supervisor/workflow_artifact_registry_suite.py`

## Phase 2: AgentSpec / ToolSpec Capability Graph Extension

**Status:** completed

**Goal:** teach registry which agent/tool can produce or consume which artifacts.

**Tasks:**

- Consume `configs/runtime/workflow-artifacts.v1.json` as the artifact vocabulary source.
- Normalize current `calendar_fact` naming drift by either replacing it with
  `academic_calendar_facts` or declaring a durable alias in registry validation.
- Extend registry schema or add a sidecar runtime config with:
  - `produces`
  - `consumes`
  - `required_inputs`
  - `source_truth_owner`
  - `freshness_policy`
  - `answer_eligible`
  - `requires_grounding`
  - `state_changing`
  - `opening_gate`
  - `eval_denominator`
- Write `CAPABILITY-GRAPH.md` describing initial producer/consumer matrix.
- Add drift tests proving closed tools or state-changing tools cannot become producers by config
  typo.
- Add drift tests proving AgentSpec context projection kinds are registered artifacts or explicit
  aliases.
- Keep runtime env simple; do not introduce per-artifact env allowlists.

**Exit Criteria:**

- Resolver can query one canonical registry/config for artifact producer/consumer ownership.
- Registry refuses ambiguous producer ownership unless explicitly modeled as ordered fallback.
- Phase 2 must not leave a hidden difference between AgentSpec context projection kinds and artifact
  ontology.

**Execution Evidence:**

- `configs/runtime/workflow-artifacts.v1.json`
- `CAPABILITY-GRAPH.md`
- [artifact_registry.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/runtimepolicy/artifact_registry.go)
- [artifact_registry_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/runtimepolicy/artifact_registry_test.go)
- [workflow_artifact_registry.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/workflow_artifact_registry.py)
- [workflow_artifact_registry_loader_suite.py](/home/reptilian/code/campus-agent/tests/supervisor/workflow_artifact_registry_loader_suite.py)

## Phase 3: CapabilityPlan Contract And Planner Output

**Status:** completed

**Goal:** introduce planner output that describes what artifacts are needed, not which bespoke
scenario branch to run.

**Tasks:**

- Define `CapabilityPlan` shape in Go runtime internals only; do not promote it to public/shared
  contract in this phase.
- Include:
  - capability
  - user goal summary
  - required artifacts
  - optional artifacts
  - constraints
  - answer policy
  - grounding policy
  - budget
  - fail-close posture
- Add fixture for selected notice follow-through.
- Add negative fixtures for ineligible selected notice, normal single tool lookup and transaction
  request.
- Keep existing `WorkflowPlan` public/runtime shape stable until resolver phase.

**Exit Criteria:**

- Planner can emit `CapabilityPlan` for selected notice follow-through while existing behavior remains
  unchanged.
- Planner does not emit multi-step for ordinary campus-services, notice discover/get or direct RAG.
- No public API or shared contract consumer depends on `CapabilityPlan` yet.

**Execution Evidence:**

- [capability_plan.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/capability_plan.go)
- [capability_plan_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/capability_plan_test.go)
- [planner.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/planner.go)
- [request_policy_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/request_policy_test.go)

## Phase 4: Resolver And WorkflowPlan Compilation

**Status:** completed

**Goal:** compile `CapabilityPlan` into executable `WorkflowPlan` using registry truth.

**Tasks:**

- Implement resolver package under Go supervisor runtime.
- Resolve required artifacts to producer steps using the artifact registry or a validated
  derivative.
- Check allowed agents/tools, opening gates, source truth owner, budget and answer eligibility.
- Generate step dependencies and context projection requirements.
- Normalize fail-close reasons:
  - artifact owner missing
  - producer closed
  - tool gate closed
  - ambiguous producer
  - dependency cycle
  - budget exceeded
  - ineligible artifact for answer
- Add tests for success and each fail-close reason.
- Add a guard that resolver has no provider/model dependency.

**Exit Criteria:**

- Selected notice follow-through can be represented by resolver output.
- Adding a new producer in registry does not require planner scenario code.

**Execution Evidence:**

- [capability_resolver.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/capability_resolver.go)
- [capability_resolver_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/capability_resolver_test.go)
- [workflow_plan.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/workflow_plan.go)
- [runtime_decisions.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/runtime_decisions.go)
- [request_policy_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/request_policy_test.go)

## Phase 5: Workflow Runner Artifact Validation

**Status:** completed

**Goal:** ensure executed steps produce the declared artifacts and cannot leak raw payloads into
workflow truth.

**Tasks:**

- Validate each step output projection kind against expected artifact.
- Check required artifacts before finalization.
- Add dependency and budget checks.
- Add bounded retry/timeout posture where currently missing.
- Record artifact ids, producer step ids, result hashes and sanitized source refs in workflow trace.
- Preserve `needs_clarification` / `no_answer` completed terminal semantics.

**Exit Criteria:**

- Runtime can distinguish step execution success from artifact completeness failure.
- Workflow trace exposes enough artifact summary for eval/operator review without raw payload.
- Artifact completeness failures are not collapsed into generic bridge/runtime errors.

**Execution Evidence:**

- [workflow_plan.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/workflow_plan.go)
- [request.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/request.go)
- [runtime_decisions.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/runtime_decisions.go)
- [execution_multistep_runner.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/httpapi/execution_multistep_runner.go)
- [answer_multistep_bridge_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/httpapi/answer_multistep_bridge_test.go)

## Phase 6: Step-Local Agents SDK Harness Alignment

**Status:** completed

**Goal:** align SDK-backed step execution with harness artifacts without giving SDK global authority.

**Tasks:**

- Standardize Python worker step runner input:
  - AgentRequest
  - allowed tools
  - workflow context
  - expected output artifacts
- Map SDK structured output to repo-owned projection validators.
- Ensure SDK handoffs remain disabled or ignored unless the step explicitly admits them.
- Sanitize SDK trace into low-cardinality correlation fields.
- Add tests proving SDK cannot add tools outside Go allowed-tools or emit SDK-native artifact truth.

**Exit Criteria:**

- SDK-backed and direct-runtime steps both produce the same artifact envelope.
- SDK failure maps to stable fail-close reasons.
- SDK handoffs remain non-canonical unless a later phase explicitly admits them.

**Execution Evidence:**

- [supervisor-execution.openapi.yaml](/home/reptilian/code/campus-agent/docs/contracts/schemas/supervisor-execution.openapi.yaml)
- [generate_supervisor_execution_contracts.py](/home/reptilian/code/campus-agent/scripts/generate_supervisor_execution_contracts.py)
- [supervisor_execution_contract.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/contracts/supervisor_execution_contract.go)
- [supervisor_execution_contract.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated/supervisor_execution_contract.py)
- [models_runtime.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/models_runtime.py)
- [bridge_payload.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/bridge_payload.go)
- [bridge_v6_parser.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/bridge_v6_parser.py)
- [agents_sdk_runner.py](/home/reptilian/code/campus-agent/apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py)

## Phase 7: Selected Notice Follow-Through Migration

**Status:** completed

**Goal:** migrate the current real `multi_step` path to harness-generated workflow.

**Current Behavior To Preserve:**

```text
selected notice context
-> rag knowledge follow-through
```

**Tasks:**

- Emit `CapabilityPlan` for eligible selected regulation-like notice follow-through.
- Resolve to notice context producer + RAG grounding/synthesis step.
- Preserve current ineligible target-surface fail-close reason.
- Preserve config/runtime gates for `SUPERVISOR_API_MULTI_STEP_WORKFLOW_ENABLED` and workflow run
  store readiness.
- Update Go/Python/eval tests to assert harness-generated plan and artifact usage.

**Exit Criteria:**

- Behavior is parity-equivalent to current hand-written multi-step path.
- Planner no longer needs a bespoke fixed-step constructor for this case.
- Phase 8 may not start until this parity gate passes.

**Execution Evidence:**

- [planner.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/planner.go)
- [workflow_plan.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/workflow_plan.go)
- [planner_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/planner_test.go)
- [capability_plan_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/capability_plan_test.go)

## Phase 8: Transport Baseline + Notice Override Expansion Plan

**Status:** completed for current runtime closeout

**Goal:** prepare the first new composite capability as artifact-driven workflow, without opening it
by scenario if-else.

This phase remains planning/admission only unless Phase 7 parity has completed.

**Target Shape:**

```text
transport schedule question
-> ScheduleBaseline
-> NoticeChangeSet
-> EvidenceBundle / GroundingVerdict
-> supervisor finalization
```

**Tasks:**

- Refresh readiness evidence for `transport_schedule_lookup`, notice change facts and RAG grounding.
- Define admission rules for when notice override is required.
- Add eval cases for:
  - baseline only
  - baseline + temporary notice
  - conflicting source
  - stale notice
  - missing override evidence
  - no answer / clarification
- Keep product opening behind gate.
- Do not add planner scenario branches for this expansion.

**Exit Criteria:**

- Expansion can be implemented by registry/artifact additions plus resolver rules, not new planner
  scenario branches.
- Public product opening remains blocked until eval and smoke pass.
- If Phase 7 parity is not complete, Phase 8 remains planning-only.

## Phase 9: Eval, Observability And Closeout

**Status:** planned

**Goal:** make harness behavior regression-safe and operator-readable.

**Tasks:**

- Add harness-level eval fixture denominator:
  - expected artifacts
  - selected producers
  - selected tools
  - step dependencies
  - projection completeness
  - final answer usage
  - fail-close reason
- Add workflow trace gate checks for artifact graph.
- Update architecture docs and workstream closeout ledger.
- Run focused Go/Python/eval/docs verification.

**Exit Criteria:**

- Workstream can be marked completed with evidence.
- Future composite capabilities have a repeatable admission checklist.

**Execution Evidence:**

- [supervisor-execution.openapi.yaml](/home/reptilian/code/campus-agent/docs/contracts/schemas/supervisor-execution.openapi.yaml)
- [generate_supervisor_execution_contracts.py](/home/reptilian/code/campus-agent/scripts/generate_supervisor_execution_contracts.py)
- [models_runtime.py](/home/reptilian/code/campus-agent/packages/contracts/src/campus_contracts/models_runtime.py)
- [workflow_trace_gate.py](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/workflow_trace_gate.py)
- [finalizer.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/httpapi/finalizer.go)
- [answer_multistep_bridge_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/httpapi/answer_multistep_bridge_test.go)
- [finalizer_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/httpapi/finalizer_test.go)
- [GAP-LEDGER.md](/home/reptilian/code/campus-agent/.planning/workstreams/agent-harness-capability-graph-runtime/GAP-LEDGER.md)
