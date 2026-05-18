---
doc_type: readiness_matrix
workstream: governed-multi-agent-workflow-runtime
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Readiness Matrix: Governed Multi-Agent Workflow Runtime

This matrix is the Phase 1 artifact. It is intentionally present before implementation so the
workstream cannot resume from a vague "tools look ready" judgment.

## Verdict

**Current verdict:** Phase 1 executed; ready to resume runtime implementation.

Reason: external dependencies now have current evidence mapping. `navigation-agent` place/stop
context is no longer part of the first pilot and is marked `not_applicable`; `rag-agent` bounded
grounding has fresh passing evidence. Runtime implementation can resume because every first-pilot
external dependency row now has explicit `ready` or `not_applicable` verdict.

Internal gates are listed separately so the workstream does not self-block. They are produced by
later phases and block only their dependent phase exits, not Phase 1 completion.

## Evidence Contract

Each dependency row must be updated with:

- `owner_workstream`: completed or active workstream that owns the readiness evidence
- `required_capability`: exact capability, projection, or fail-close behavior needed by this line
- `evidence_paths`: tests, eval fixtures, smoke artifacts, docs, or release gates proving it
- `verification_command`: repeatable command for the evidence where available
- `freshness_date`: date the evidence was last verified against current worktree or merged truth
- `verdict`: `ready`, `blocked`, `stale`, or `not_applicable`
- `runtime_admission_impact`: what must stay closed if this dependency is not ready

## External Dependency Rows

| Dependency | Required Capability | Owner Workstream | Evidence Paths | Verification Command | Freshness Date | Verdict | Runtime Admission Impact |
| ---------- | ------------------- | ---------------- | -------------- | -------------------- | -------------- | ------- | ------------------------ |
| `transport_schedule_lookup` | Baseline schedule, next departure, service windows, exceptions, source conflict handling, fail-close semantics | `campus-services-runtime-tool-gap-closeout`; `agents-sdk-runtime-surface-expansion`; `supervisor-multi-agent-runtime-contract-hardening` | `configs/runtime/tools.v1.json`; `configs/runtime/agents.v1.json`; `tests/agent/test_campus_services_agent.py`; `tests/supervisor/agents_sdk_runner_suite.py`; `tests/evals/workflow_trace_gate_suite.py` | `uv run --all-packages python -m unittest tests.agent.test_campus_services_agent -q`; `uv run --all-packages python -m unittest tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.provider_function_calling_suite -q`; `uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite -q` | `2026-05-06` | `ready` | none for transport baseline |
| `campus_notice_discover` | Notice search/card discovery with title, source URL, date/category filters, bounded result projection | `notice-agent-card-first-tool-boundary`; `agents-sdk-runtime-surface-expansion`; `supervisor-multi-agent-runtime-contract-hardening` | `configs/runtime/tools.v1.json`; `configs/runtime/agents.v1.json`; `tests/agent/test_notice_agent.py`; `tests/supervisor/tool_spec_registry_suite.py`; `tests/supervisor/agents_sdk_runner_suite.py`; `tests/supervisor/provider_function_calling_suite.py` | `uv run --all-packages python -m unittest tests.agent.test_notice_agent -q`; `uv run --all-packages python -m unittest tests.supervisor.tool_spec_registry_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.provider_function_calling_suite -q` | `2026-05-06` | `ready` | none for notice discovery |
| selected notice card/context projection | Deterministic selected notice card/context resolve; no top-level `campus_notice_get` provider/SDK tool reopening | `notice-agent-card-first-tool-boundary`; `supervisor-multi-agent-runtime-contract-hardening` | `tests/agent/test_notice_runtime_wiring.py`; `tests/contracts/contract_models_workflow_projection_refs_suite.py`; `tests/contracts/supervisor_execution_fixture_matrix_suite.py`; `tests/contracts/contract_models_services_and_notice_suite.py`; `tests/supervisor/provider_function_calling_suite.py`; `configs/runtime/tools.v1.json` | `uv run --all-packages python -m unittest tests.agent.test_notice_runtime_wiring tests.contracts.contract_models_workflow_projection_refs_suite tests.contracts.supervisor_execution_fixture_matrix_suite tests.contracts.contract_models_services_and_notice_suite -q`; `uv run --all-packages python -m unittest tests.supervisor.provider_function_calling_suite -q` | `2026-05-06` | `ready` | none for selected notice context |
| `navigation-agent` place/stop context | Place/stop context output without owning timetable or service-status truth | `campus-place-finding-foundation`; `supervisor-multi-agent-runtime-contract-hardening` | `configs/runtime/agents.v1.json`; `tests/agent/test_navigation_agent.py`; `tests/supervisor/agent_dispatch_suite.py`; `tests/contracts/contract_models_services_and_notice_suite.py` | `uv run --all-packages python -m unittest tests.agent.test_navigation_agent -q`; `uv run --all-packages python -m unittest tests.supervisor.agent_dispatch_suite -q`; `uv run --all-packages python -m unittest tests.contracts.contract_models_services_and_notice_suite -q` | `2026-05-06` | `not_applicable` | keep navigation/place-stop step out of first pilot |
| `rag-agent` bounded grounding | Consume bounded upstream projections and emit grounded synthesis or `GroundingVerdict` fail-close | `rag-agent-internal-agents-sdk-loop`; `campus-bounded-autonomous-rag-completion`; `supervisor-multi-agent-runtime-contract-hardening` | `tests/agent/rag_agent_answer_grounding_suite.py`; `tests/agent/rag_agent_sdk_service_suite.py`; `tests/agent/rag_agent_sdk_contract_suite.py`; `tests/evals/workflow_trace_gate_suite.py`; `tests/agent/rag_agent_handbook_category_discovery_suite.py`; `tests/agent/rag_agent_realistic_e2e_samples_suite.py` | `uv run --all-packages python -m unittest tests.agent.rag_agent_answer_grounding_suite -q`; `uv run --all-packages python -m unittest tests.agent.rag_agent_handbook_category_discovery_suite tests.agent.rag_agent_realistic_e2e_samples_suite -q` | `2026-05-06` | `ready` | none for grounding step |
| current `AgentSpec` / `ToolSpec` baseline | Existing agent/tool registries and drift guards prove allowed agents/tools derive from repo-owned specs, not SDK/provider free choice | `supervisor-multi-agent-runtime-contract-hardening`; `execution-tool-calling-governance`; `agents-sdk-runtime-surface-expansion` | `configs/runtime/agents.v1.json`; `configs/runtime/tools.v1.json`; `tests/supervisor/agent_spec_registry_suite.py`; `tests/supervisor/tool_spec_registry_suite.py`; `tests/supervisor/agent_dispatch_suite.py` | `uv run --all-packages python -m unittest tests.supervisor.agent_spec_registry_suite tests.supervisor.tool_spec_registry_suite tests.supervisor.agent_dispatch_suite -q` | `2026-05-06` | `ready` | none for registry baseline |

## Blocked Evidence

- `navigation-agent` remains runtime-closed and does not provide the pilot's full `PlaceContext` /
  `StopContext` projection requirement, but that capability is explicitly out of scope for the
  current first pilot.
- `rag-agent` bounded grounding previously failed on `保研流程是什么？` because `student_rules`
  query planning treated `保研/推免 + 流程` as category ambiguity. The planner now defaults those
  procedure queries to the standard undergraduate recommendation policy and keeps explicit athlete
  queries on the athlete policy; focused suites now pass.

## Internal Gate Rows

These rows are owned by this workstream. They are not Phase 1 exit blockers; they become exit
criteria for the phase listed in `Owner Phase`.

| Gate | Required Artifact | Owner Phase | Planned Artifact / Evidence | Verification Command | Current State | Blocks |
| ---- | ----------------- | ----------- | --------------------------- | -------------------- | ------------- | ------ |
| private step artifact contract | Versioned private projection payload schemas for `ScheduleBaseline`, `NoticeChangeSet`, `CanonicalNoticeContext`, `EvidenceBundle`, and `GroundingVerdict` | Phase 2 | repo-owned Go projection constructors/validators in `apps/supervisor-api/internal/execution`; canonical `StepOutputProjectionKind` enums in `docs/contracts/schemas/supervisor-execution.openapi.yaml` + generated artifacts; workflow projection ref contract/tests | `uv run --all-packages python -m unittest tests.contracts.contract_models_workflow_projection_refs_suite tests.contracts.contract_models_workflow_execution_context_suite tests.contracts.canonical_supervisor_execution_schema_suite tests.contracts.supervisor_execution_fixture_matrix_suite -q`; `cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution` | `completed` | Phase 3 fixtures and Phase 4/5/6 implementation |
| `AgentSpec` workflow extension | AgentSpec entries declare accepted workflow input projections, output projection kinds, allowed tools, trace policy, and opening gate for pilot agents | Phase 4 | `configs/runtime/agents.v1.json`; Go planner validation in `apps/supervisor-api/internal/structuredplanning`; Python delegate-map and agent-registry validation in `tests/supervisor/agent_spec_registry_suite.py` and `tests/supervisor/agent_dispatch_suite.py`; eval denominator checks in workflow trace suites | `cd apps/supervisor-api && go test ./internal/structuredplanning`; `uv run --all-packages python -m unittest tests.supervisor.agent_spec_registry_suite tests.supervisor.agent_dispatch_suite -q`; `uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite -q` | `completed` | Phase 4 exit and Phase 5 runner |
| workflow trace denominator | Eval fixtures assert workflow mode, ordered steps, allowed agents/tools, projections, source refs, fail-close branches, and expected multi-step projection kind order | Phase 3 | `packages/evals` fixture/gate updates; `multi-agent-live-smoke` replay gate now replays current process-smoke artifacts, overwrites stale summaries on rerun, and blocks when required rag bounded projections disappear | `uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.evals.multi_agent_product_path_eval_gate_profile_suite -q`; `uv run --all-packages python -m campus_evals.multi_agent_live_smoke_gate accept --output-dir .tmp/governed-multi-agent-workflow-runtime/multi-agent-live-smoke --reruns 1 --timeout-seconds 45 --verbose` | `completed` | Phase 5 runner execution |
| minimum safe runtime trace | Step execution emits sanitized `workflow_run_ref`, step id, agent id, status, input projection refs, output projection id/hash, fail-close reason, and no raw payload | Phase 5 | canonical schema + generated contract refresh; Go bridge tests; Python parser tests; Agents SDK trace redaction and workflow-step trace suites | `uv run --all-packages python -m scripts.generate_supervisor_execution_contracts`; `uv run --all-packages python -m unittest tests.contracts.contract_models_workflow_projection_refs_suite tests.contracts.contract_models_workflow_execution_context_suite tests.contracts.canonical_supervisor_execution_schema_suite tests.contracts.supervisor_execution_fixture_matrix_suite tests.supervisor.agents_sdk_runner_suite tests.supervisor.agents_sdk_trace_projection_suite tests.supervisor.agents_sdk_workflow_step_trace_suite -q`; `cd apps/supervisor-api && go test ./internal/httpapi ./internal/execution` | `completed` | Phase 6 exit |
| operator-safe projection closeout | Operator summary, agent step/projection summary, tool correlation, provider call id projection, drift guards | Phase 8 | `WorkflowRun.ToolCallSummaries` persisted as repo-owned run truth; finalizer uses recorded `selected_tools` and tool summaries; real replay artifact at `.tmp/governed-multi-agent-workflow-runtime/multi-agent-live-smoke/multi-agent-live-smoke-gate.json` proves zero workflow-trace failures | See Phase 8 execution evidence in `ROADMAP.md` for the exact Go tests, eval suites, and live-smoke acceptance command. | `completed` | public/product rollout |

## Phase 1 Exit Rule

Phase 1 is complete only when every external dependency required for the first pilot has one of:

- `ready` with current evidence and a repeatable verification path
- `not_applicable` with a written reason explaining why the pilot no longer needs it

Any `blocked` or `stale` external dependency row keeps implementation phases deferred. Internal
gate rows are completed in their owner phases and must not be used to block Phase 2 planning work.
