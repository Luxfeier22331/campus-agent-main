---
doc_type: roadmap
status: completed
created: 2026-05-01
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Governed Multi-Agent Workflow Runtime

## Phase Status

- [x] **Phase 0: Planning And Deferred Admission** — create workstream, freeze target shape, dependencies, blockers, and phase sequence.
- [x] **Phase 1: Tool And Agent Readiness Matrix** — executed; first-pilot readiness evidence refreshed and implementation unblocked.
- [x] **Phase 2: Private Step Artifact Contract** — first slice implemented in Go runtime with `schedule_baseline` and existing `notice_context` bounded projections.
- [x] **Phase 3: Workflow Trace Denominator** — add eval fixtures for workflow mode, step sequence, allowed agents/tools, context projection, and fail-close branches using the Phase 2 contract.
- [x] **Phase 4: AgentSpec And Go WorkflowPlan Admission Extension** — first slice implemented for the admitted `campus-services -> notice -> rag` pilot.
- [x] **Phase 5: Python Step Runner Runtime And Step-Local SDK Adapter** — execute admitted ordered steps and validate typed projections without creating an SDK-owned global graph.
- [x] **Phase 6: Domain Agent Projection Outputs** — implemented for the admitted first pilot; `campus-services-agent` emits `schedule_baseline`, `notice-agent` emits `notice_context`, and `rag-agent` now emits bounded `evidence_bundle` / `grounding_verdict` workflow projections.
- [x] **Phase 7: Transport Schedule + Notice Override + Place Context Pilot** — first end-to-end governed workflow pilot now passes real `multi-agent-live-smoke`; `needs_clarification` remains a valid bounded terminal outcome with retained rag projections.
- [x] **Phase 8: Observability, Eval, And Guardrail Closeout** — hardened trace projection, release-gate denominator, drift guards, and failure semantics.
- [x] **Phase 9: Second Scenario Admission Decision** — repo-owned decision recorded: keep the second governed scenario closed.

## Phase 0: Planning And Deferred Admission

**Status:** completed

**Goal:** Plan the workstream without starting implementation.

**Deliverables:**

- Native workstream directory.
- Requirements, roadmap, state, and planning phase plan.
- Deferred / blocked state until tool and agent prerequisites are verified.
- Registry entry under Deferred.

**Verification:**

```bash
pnpm docs:lint
git diff --check
```

## Phase 1: Tool And Agent Readiness Matrix

**Status:** completed

**Goal:** prove the bottom-level tools and agents are reliable enough to compose.

**Scope:**

- `transport_schedule_lookup` readiness evidence.
- `campus_notice_discover` readiness evidence.
- selected notice card/context projection evidence; no top-level `campus_notice_get` reopening.
- `rag-agent` bounded upstream context + grounding readiness evidence.
- current `AgentSpec` / `ToolSpec` baseline and drift guard evidence.
- Step-local SDK readiness posture for future admitted workflow steps.

**Exit Criteria:**

- Each dependency has a current test/eval artifact or explicit blocker.
- `READINESS-MATRIX.md` is populated with owner workstream, evidence paths, verification command,
  freshness date, verdict, and runtime admission impact for each external pilot dependency.
- `READINESS-MATRIX.md` internal gates remain planned owner-phase gates, not Phase 1 blockers.
- No multi-agent runtime implementation starts while any first-pilot dependency row remains
  `blocked` or `stale`.

**Execution Evidence (2026-05-06):**

```bash
uv run --all-packages python -m unittest tests.supervisor.agent_spec_registry_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agent_dispatch_suite -q
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent -q
uv run --all-packages python -m unittest tests.agent.test_notice_agent tests.agent.test_navigation_agent -q
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite -q
uv run --all-packages python -m unittest tests.agent.test_notice_runtime_wiring tests.contracts.contract_models_workflow_projection_refs_suite tests.contracts.supervisor_execution_fixture_matrix_suite tests.contracts.contract_models_services_and_notice_suite -q
uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.provider_function_calling_suite -q
uv run --all-packages python -m unittest tests.agent.rag_agent_answer_grounding_suite -q
uv run --all-packages python -m unittest tests.agent.rag_agent_handbook_category_discovery_suite tests.agent.rag_agent_realistic_e2e_samples_suite -q
```

`navigation-agent` remains outside the first pilot and is recorded as `not_applicable`. The
`rag-agent` grounding row is now `ready` after the `student_rules` `保研/推免` procedure planning
fix and focused suite reruns.

## Phase 2: Private Step Artifact Contract

**Status:** first slice implemented

**Goal:** define private workflow projections before trace fixtures or runtime work depend on them.

**Scope:**

- Envelope remains the repo-owned `StepOutputProjection` / `workflow_trace_summary` wire shape.
- Private payload schema starts outside `packages/contracts`, with intended artifact location:
  `configs/runtime/workflow-step-projections.v1.json` or an equivalent private runtime config.
- Go validation owner: `apps/supervisor-api` planning/runtime internals.
- Python validation owner: `apps/supervisor-agent-worker` step runner / delegate internals.
- Eval validation owner: `packages/evals` workflow trace denominator.
- `ScheduleBaseline`.
- `NoticeChangeSet`.
- `CanonicalNoticeContext`.
- `EvidenceBundle`.
- `GroundingVerdict`.
- Projection hash, length limit, visibility posture, source refs, and safety summary.
- Cross-language validator tests proving Go/Python accept the same schema version and reject raw
  payload keys.
- Contract promotion rule: no `packages/contracts` promotion until the private schema has survived
  the first pilot and Phase 8 closeout without shape drift.
- Step-local SDK adapter envelope:
  - SDK can run only inside an admitted step.
  - SDK input must be compiled from `WorkflowPlan` step input projections and allowed tools.
  - SDK output must be validated into repo-owned projection types.
  - SDK-native graph, session state, trace, prompt, transcript, and tool payload cannot become
    workflow truth.

**Execution Evidence (2026-05-06):**

```bash
cd apps/supervisor-api && go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/execution ./internal/httpapi
```

## Phase 3: Workflow Trace Denominator

**Status:** completed

**Goal:** make multi-agent correctness machine-checkable before runtime work.

**Scope:**

- Pilot case fixtures for transport/schedule + notice override + place context.
- Expected workflow mode and ordered step sequence.
- Expected allowed agents / allowed tools.
- Expected projection kinds and required source refs from Phase 2.
- Fail-close cases for missing baseline, missing selected notice context, ambiguous stop, stale
  projection, insufficient evidence, and closed capability.

**Execution Evidence (2026-05-06):**

```bash
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite -q
uv run --all-packages python -m campus_evals.multi_agent_live_smoke_gate accept --output-dir .tmp/governed-multi-agent-workflow-runtime/multi-agent-live-smoke --reruns 1 --timeout-seconds 45 --verbose
```

Phase 3 now includes:

- `workflow-transport-notice-knowledge-pilot-multistep` canonical fixture aligned to the current
  runtime contract.
- governed-workflow-only default live-smoke profile set.
- blocking workflow-trace replay over the real process-smoke artifacts.
- stale `process-smoke-summary.json` overwrite fix so reruns replay the current artifact rather than
  an older failing summary.
- expected multi-step `context_projection` kind order assertions so losing rag bounded projections is
  a blocking regression, not a soft trace completeness miss.

## Phase 4: AgentSpec And Go WorkflowPlan Admission Extension

**Status:** first slice implemented

**Goal:** teach AgentSpec and Go to express admitted manager-style multi-agent plans.

**Scope:**

- Extend or validate `configs/runtime/agents.v1.json` as the repo-owned `AgentSpec` source for
  pilot agents.
- AgentSpec entries declare accepted workflow input projection kinds, output projection kinds,
  allowed tools, context filter policy, trace projection policy, opening gate, timeout/budget, and
  retry/replan posture.
- Go `WorkflowPlan.allowed_agents` must validate against AgentSpec.
- Python delegate map must validate against the same AgentSpec ids.
- Eval denominator must assert expected AgentSpec ids rather than free-form target strings.
- `allowed_agents`.
- `allowed_tools`.
- ordered step plan.
- required input / output projection kinds.
- step timeout / budget.
- retry / replan posture.
- terminal fail-close policy.
- trace projection skeleton.

**Non-Scope:** executing semantic agent reasoning in Go.

**Execution Evidence (2026-05-06):**

- `PlanWithPolicy(...)` now emits the first admitted multi-step transport pilot when all of the
  following are present:
  - `requested_capability = campus_services`
  - selected notice context
  - `requested_scope = regulations/student_rules`
  - multi-step enabled
  - transport + notice-followthrough signals
- `runMultiStepBridgeExecution(...)` now extracts and persists `schedule_baseline` before the
  notice and RAG steps.

## Phase 5: Python Step Runner Runtime And Step-Local SDK Adapter

**Status:** completed

**Goal:** execute the admitted Go plan in Python without creating a free-form agent graph.

**Scope:**

- Step runner consumes `WorkflowPlan`.
- Agent dispatcher runs one bounded step at a time.
- Provider function calling and SDK function tools remain limited to Go-admitted allowed tools.
- Step-local Agents SDK adapter can be used as runtime substrate only after the step is admitted.
- SDK-native handoff graph cannot replace `WorkflowPlan`; SDK-native trace cannot become
  `workflow_trace_summary`.
- Step output validation and fail-close mapping.
- Minimum safe runtime trace emitted before Phase 5 exit:
  - `workflow_run_ref`
  - step id
  - agent id / AgentSpec id
  - step status and terminal reason
  - input projection refs
  - output projection id/hash/kind
  - fail-close reason when present
  - no raw prompt/provider/tool/source payload
- No raw provider/tool/source payload in `AgentResponse` or workflow trace.

**Execution Evidence (2026-05-06):**

```bash
uv run --all-packages python -m scripts.generate_supervisor_execution_contracts
uv run --all-packages python -m unittest tests.contracts.contract_models_workflow_projection_refs_suite tests.contracts.contract_models_workflow_execution_context_suite tests.contracts.canonical_supervisor_execution_schema_suite tests.contracts.supervisor_execution_fixture_matrix_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.agents_sdk_workflow_step_trace_suite -q
cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution
```

Phase 5 now includes:

- `WorkflowAgentContext` step execution metadata for `workflow_run_ref`, `step_id`, and
  `agent_id`.
- Go bridge projection of repo-owned step execution metadata into admitted handoff requests.
- Python bridge validation of the same metadata against generated canonical contract artifacts.
- Sanitized step-local Agents SDK trace fields for input projection refs, fail-close reason, and
  transport output projection summary without raw prompt/provider/tool/source payload leakage.

## Phase 6: Domain Agent Projection Outputs

**Status:** completed

**Goal:** make selected domain agents produce/consume pilot projections.

**Scope:**

- `campus-services-agent` emits `ScheduleBaseline`.
- `notice-agent` emits `NoticeChangeSet` / `CanonicalNoticeContext`.
- `rag-agent` consumes bounded upstream context and emits `EvidenceBundle` /
  `GroundingVerdict`.
- No separate `grounding-validator-agent` exists in the first pilot. If a later phase wants one, it
  must first add AgentSpec, projection, readiness, and eval denominator entries.

**Execution Evidence (2026-05-06):**

```bash
cd apps/supervisor-api && go test ./internal/httpapi -run 'TestAnswerExecutes(RecordedMultiStepWorkflow|TransportNoticeKnowledgePilotWorkflow)'
uv run --all-packages python -m unittest tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.test_supervisor_runtime_process_smoke -q
cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution ./internal/structuredplanning
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.test_supervisor_runtime_process_smoke -q
```

**Current Truth:**

- Private workflow projection truth is currently carried by repo-owned Go constructors/validators plus
  canonical `StepOutputProjectionKind` contract enums and workflow-trace validators; there is no
  separate `configs/runtime/workflow-step-projections.v1.json` file in merged truth.
- `navigation-agent` `PlaceContext` / `StopContext` stays out of the admitted first pilot.

## Phase 7: Transport Schedule + Notice Override + Place Context Pilot

**Status:** completed

**Goal:** prove the first governed multi-agent workflow end to end.

**Scope:**

- Go planner chooses multi-step only for admitted pilot cases.
- Python step runner executes ordered agent steps.
- Go finalizer returns a supervisor-style response.
- Trace proves step sequence and bounded context exchange.
- Fail-close paths remain deterministic.

**Execution Evidence (2026-05-06):**

```bash
cd apps/supervisor-api && go test ./internal/httpapi -run 'TestAnswerExecutes(RecordedMultiStepWorkflow|TransportNoticeKnowledgePilotWorkflow)'
cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution ./internal/structuredplanning
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite tests.test_supervisor_runtime_process_smoke tests.contracts.contract_models_workflow_projection_refs_suite tests.contracts.contract_models_workflow_execution_context_suite tests.contracts.canonical_supervisor_execution_schema_suite tests.contracts.supervisor_execution_fixture_matrix_suite -q
uv run --all-packages python -m campus_evals.multi_agent_live_smoke_gate accept --output-dir .tmp/governed-multi-agent-workflow-runtime/multi-agent-live-smoke --reruns 1 --timeout-seconds 45 --verbose
```

**Closeout Notes:**

- first-pilot rag steps now materialize bounded `evidence_bundle` and `grounding_verdict`
  projections for `completed`, `needs_clarification`, and `no_answer` result statuses when bounded
  result payload exists.
- `needs_clarification` / `no_answer` now map to completed workflow-run terminal state instead of
  false `failed` state.
- real smoke gate passed with `5/5` profiles and zero workflow-trace replay failures.

## Phase 8: Observability, Eval, And Guardrail Closeout

**Status:** completed

**Goal:** make the workflow operable and regression-safe.

**Scope:**

- Operator-safe workflow summary.
- Agent step and projection summary.
- Tool call correlation and provider call id projection.
- Eval release gate for workflow trace.
- Drift guards preventing raw payload leakage and hidden global tool choice.

**Execution Evidence (2026-05-06):**

```bash
cd apps/supervisor-api && go test ./internal/httpapi -run 'TestAnswerExecutes(RecordedMultiStepWorkflow|TransportNoticeKnowledgePilotWorkflow)$|TestFinalizeAgentBridgeResponseUsesRecordedNoticeMultiStepWorkflowRun$'
cd apps/supervisor-api && go test ./internal/execution
cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution ./internal/structuredplanning
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite -q
uv run --all-packages python -m campus_evals.multi_agent_live_smoke_gate accept --output-dir .tmp/governed-multi-agent-workflow-runtime/multi-agent-live-smoke --reruns 1 --timeout-seconds 45 --verbose
```

**Closeout Notes:**

- `WorkflowRun` 现在持久化 step-level `ToolCallSummary`，operator summary 不再只看 final
  step。
- multi-step `selected_tools` 改为直接来自 recorded run truth，而不是从最终结果反推。
- bounded provenance 在 step 结果没有直接 `source_refs` 时，可回退到该 source step 的
  output projection ids；这保证真实 replay 仍可通过 workflow-trace gate。
- `workflow-transport-notice-knowledge-pilot-multistep` fixture 已更新为真实两步 tool trace：
  `transport_schedule_lookup` + `retrieval.query`。

## Phase 9: Second Scenario Admission Decision

**Status:** completed

**Goal:** decide whether to expand after the pilot is proven.

**Candidate Scenario:**

```text
read-only service guide/status/contact question
-> campus-services-agent guide/status/contact facts
-> navigation-agent place context
-> rag-agent policy/reference evidence
-> Go supervisor finalization
```

**Decision:** keep the second governed scenario closed in this workstream.

**Reasoning:**

- 第一条 governed workflow pilot 已证明 runtime contract、trace、projection 与 smoke
  denominator 可以成立。
- 第二场景若 admission，会同时引入 `service_guide/status/contact` 组合和
  `navigation-agent` 再入场，不属于 pilot closeout 范畴。
- 这类扩张应在新的 owner workstream 内完成 readiness、admission、eval 与 real-product
  acceptance，而不是借本线 closeout 顺手扩容。

**Reopen Trigger:**

- repo 显式决定 admission 第二个 governed 场景；
- 或现有 first pilot 再次丢失 step-level tool summary、bounded provenance、
  `needs_clarification`/`no_answer` terminal semantics 之一。

**Non-Scope:** booking, submission, payment, ticket creation, workflow approval, or any
state-changing service action. Those require a separate approval / HITL / audit / rollback
workstream.
