---
doc_type: state
status: completed
created: 2026-05-07
updated: 2026-05-08
---

<!-- markdownlint-disable MD013 MD060 -->

# State: Transport Notice Override Harness Admission

## Current Position

**Status:** completed
**Current Phase:** Closeout
**Last Activity:** 2026-05-08
**Last Activity Description:** Completed Phase 7 focused process smoke for the admitted transport
override multi-step workflow, fixed the RAG grounding artifact gap, and kept public/chat product
entry verification delegated to `public-chat-campus-services-e2e-acceptance`.

## Current Slice

- Phase 0 complete: owner/readiness boundary frozen.
- Phase 1 complete: contract/admission seam implemented and tested.
- Phase 2 complete: `campus_notice_change_set_lookup` producer implemented over admitted truth.
- Phase 3 complete: shared execution projection enum/schema/codegen promoted.
- Phase 4 complete: transport override capability compiles through `CapabilityPlan -> resolver ->
  WorkflowPlan`.
- Phase 5 complete: runtime/finalizer/Python SDK path consumes bounded `notice_change_set`
  projections.
- Phase 6 complete: eval denominator and workflow trace gate fixture coverage added.
- Phase 7 complete: focused runtime smoke passed for the admitted
  `transport_notice_override_multistep` profile.
- Existing prerequisites are split across completed workstreams:
  - harness runtime generic capability graph / resolver / trace denominator
  - transport baseline policy and replay evidence
  - campus-services runtime tool correctness
- Opening verdict:
  - supervisor-level transport override workflow is internally admitted
  - public/chat product entry remains closed in this workstream
  - public product E2E/opening is delegated to `public-chat-campus-services-e2e-acceptance`

## Planning Repair Summary

Closed planning gaps:

- Added positive owner/runtime split in `OWNER-RUNTIME-MATRIX.md`.
- Added bounded `notice_change_set` schema and data-plane admission contract in
  `NOTICE-CHANGE-SET-CONTRACT.md`.
- Expanded roadmap from a thin four-phase stub to a seven-phase executable plan covering:
  - producer contract
  - baseline/admission gates
  - shared execution contract promotion
  - artifact registry/resolver admission
  - finalizer artifact usage
  - eval denominator and trace coverage
  - smoke/opening closeout
- Added readiness/eval matrix in `READINESS-MATRIX.md`.
- Added planning review record in `PLANNING-REVIEW.md`.

Implemented in this workstream:

- repo-owned `campus_notice_change_set_lookup` producer and structured query route
- `notice_change_set` execution projection kind / Go constructor / OpenAPI / generated Go-Python-TS
  contracts
- resolver-backed transport composite workflow with admitted step graph
- runtime projection passing, finalizer answer artifact reporting, and Python SDK output artifact
  validation
- eval fixtures for tool-family denominator and workflow trace gate
- RAG workflow projection grounding for unscoped `rag_request` steps that already carry
  `schedule_baseline` and `notice_change_set` projection refs
- structured transport schedule baseline summaries, avoiding agent/provider answer text in
  downstream evidence
- focused process smoke evidence for the admitted workflow

## Closeout Findings

- Root cause fixed:
  unscoped RAG steps previously returned `needs_clarification`, so the Go workflow artifact gate
  saw no `evidence_bundle` and failed with `supervisor_multistep_artifact_incomplete`.
- Follow-on quality issue fixed:
  the schedule baseline projection no longer uses agent `answer_text` as summary, preventing
  mock/provider text from entering grounding evidence.
- Remaining product opening work is outside this workstream:
  public/chat E2E and real environment freshness checks belong to
  `public-chat-campus-services-e2e-acceptance`.
- Incomplete media-derived transport notices must continue to fail closed until their upstream
  notice consumption/media extraction evidence is admitted.

## Reopen Rule

Reopen this workstream only if the internal supervisor-level workflow regresses:

- `schedule_baseline -> notice_change_set -> evidence_bundle/grounding_verdict` stops producing
  required artifacts;
- raw notice/OCR/provider payloads leak into workflow projections; or
- resolver admission falls back to planner scenario if-else.

## Verification

Focused verification passed:

```bash
uv run --all-packages python -m unittest \
  tests.contracts.contract_models_notice_change_set_suite \
  tests.contracts.canonical_supervisor_execution_schema_suite \
  tests.supervisor.workflow_artifact_registry_suite \
  tests.supervisor.tool_spec_registry_suite \
  tests.supervisor.agents_sdk_runner_suite \
  tests.agent.test_notice_agent \
  tests.evals.tool_family_denominator_suite \
  tests.evals.workflow_trace_gate_suite -q

cd apps/supervisor-api && go test \
  ./internal/structuredplanning \
  ./internal/structuredquery \
  ./internal/execution \
  ./internal/httpapi \
  -run 'TestTransportNoticeOverride|TestLookupCampusNoticeChangeSet|TestParseAnswerRequestResolvesTransportNoticeOverrideWorkflowPlan|TestAnswerExecutesRecordedMultiStepWorkflow|TestBridgePayloadForHandoff|TestPlanWithPolicyBuildsTransportNoticeOverrideCapabilityPreplan|TestResolveCapabilityPlanBuildsTransportNoticeOverrideWorkflowPlan'
```

Latest focused verification covered contract, runtime planning/resolver, Python SDK projection, and
eval fixture gates.

Additional closeout verification passed:

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_workflow_projection_grounding_suite \
  tests.supervisor.agent_dispatch_suite \
  tests.agent.test_notice_agent \
  tests.supervisor.agents_sdk_runner_suite \
  tests.supervisor.agents_sdk_workflow_step_trace_suite -q

uv run --all-packages ruff check \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py \
  packages/rag-agent/src/campus_rag_agent/workflow_projection_grounding.py \
  packages/rag-agent/src/campus_rag_agent/service.py \
  tests/agent/rag_agent_workflow_projection_grounding_suite.py \
  tests/supervisor/agents_sdk_runner_suite.py \
  tests/supervisor/agents_sdk_workflow_step_trace_suite.py

uv run --all-packages ruff format --check \
  apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/agents_sdk_runner.py \
  packages/rag-agent/src/campus_rag_agent/workflow_projection_grounding.py \
  packages/rag-agent/src/campus_rag_agent/service.py \
  tests/agent/rag_agent_workflow_projection_grounding_suite.py \
  tests/supervisor/agents_sdk_runner_suite.py \
  tests/supervisor/agents_sdk_workflow_step_trace_suite.py

cd apps/supervisor-api && go test \
  ./internal/structuredplanning \
  ./internal/httpapi \
  ./internal/structuredquery \
  -run 'TestResolveCapabilityPlanBuildsTransportNoticeOverrideWorkflowPlan|TestAnswerSurfacesMultiStepBridgeStepErrorBeforeArtifactCompleteness|TestAnswerFailsClosedWhenMultiStepArtifactsAreIncomplete|TestAnswerExecutesRecordedMultiStepWorkflow|TestLookupCampusNoticeChangeSet|TestTransportScheduleProjectionSummaryUsesStructuredResultNotAgentAnswerText' \
  -count=1

uv run --all-packages python -m scripts.supervisor_runtime_process_smoke \
  --output-dir .tmp/process-smoke/transport-notice-override-final-rag-projection-4 \
  --profile transport_notice_override_multistep \
  --api-port 27151 \
  --worker-port 27152 \
  --object-store-port 27161 \
  --timeout-seconds 45 \
  --startup-timeout-seconds 180
```

Focused smoke evidence:

- summary:
  `.tmp/process-smoke/transport-notice-override-final-rag-projection-4/process-smoke-summary.json`
- verdict: `passed=true`, `answer_status=200`, `status=completed`
- asserted artifacts:
  `schedule_baseline`, `notice_change_set`, `evidence_bundle`, `grounding_verdict`
- asserted workflow:
  `transport_schedule_lookup -> campus_notice_change_set_lookup -> retrieval.query`
- evidence quality:
  schedule baseline evidence is structured route/status/date summary and does not include
  `Mock Agents SDK completed`

## Next Action When Resumed

No in-scope work remains for this workstream. Continue public product entry verification in
`public-chat-campus-services-e2e-acceptance`.
