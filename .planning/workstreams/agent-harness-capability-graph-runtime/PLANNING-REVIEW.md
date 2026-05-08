---
doc_type: planning_review
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Planning Review

## Purpose

This is the requested full review after executing Phase 0 and Phase 1. Since that execution,
Phases 2 through 7 and the current-runtime slice of Phase 9 have landed in code. The former
transport expansion Phase 8 is now moved into dedicated follow-up
`transport-notice-override-harness-admission`.

## Review Verdict

The phase sequence is still correct, but current phase truth has advanced. Phase 0 and Phase 1 stay
closed, Phase 7 is now closed, and the current-runtime closeout slice of Phase 9 is also closed.
The transport expansion is real follow-up work, but it no longer blocks this workstream's closeout.

The remaining review now reduces to three concrete conclusions:

1. Phase 7 is complete: selected-notice planner admission no longer bakes a fixed
   `notice-agent -> rag-agent` step shell; it now relies on `CapabilityPlan -> resolver ->
   WorkflowPlan`.
2. Phase 9 closeout is complete for the current runtime: trace/eval/schema/generated contract now
   prove bounded final answer artifact usage.
3. Phase 8 should not block generic harness runtime closeout. It is now moved into dedicated
   follow-up `transport-notice-override-harness-admission`, where `notice_change_set` producer
   contract, eval denominator and opening evidence can be owned explicitly.

These clarifications are now reflected in the roadmap, state file and phase plans.

## Phase 0+1 Execution Review

Phase 0 and Phase 1 are accepted as complete for this workstream.

Verified evidence:

```bash
uv run --all-packages python -m unittest tests.supervisor.workflow_artifact_registry_suite -q
uv run --all-packages ruff check tests/supervisor/workflow_artifact_registry_suite.py
uv run --all-packages ruff format tests/supervisor/workflow_artifact_registry_suite.py --check
uv run --all-packages python -m unittest tests.contracts.contract_models_workflow_projection_refs_suite -q
cd apps/supervisor-api && go test ./internal/execution
pnpm docs:lint
git diff --check -- .planning/workstreams/agent-harness-capability-graph-runtime .planning/WORKSTREAMS.md configs/runtime/workflow-artifacts.v1.json tests/supervisor/workflow_artifact_registry_suite.py
```

All commands passed.

## Current Code Truth

- Artifact vocabulary and capability graph drift are already frozen in
  `configs/runtime/workflow-artifacts.v1.json`; `calendar_fact` is now an explicit alias of
  `academic_calendar_facts`, so the old Phase 2 naming risk is closed.
- Planner emits internal `CapabilityPlan`, and `runtime_decisions` resolves it through the artifact
  registry before execution.
- Workflow runner now validates expected per-step artifacts and returns dedicated terminal error
  `supervisor_multistep_artifact_incomplete` when a step reports success without the required
  bounded projections.
- Python bridge and SDK runner now receive explicit `expected_output_artifacts` truth through the
  generated bridge contract and repo-owned `WorkflowAgentContext`.
- Selected-notice knowledge follow-through no longer enters planner via explicit fixed-step
  `MultiStepNoticeKnowledgeFollowthroughPlan(...)` shell. Planner now returns capability-only
  multi-step preplan and leaves the executable workflow shape to resolver/runtime.
- Workflow trace summary now records `answer_artifact_projection_ids` and
  `answer_artifact_kinds`, so eval/operator review can prove which bounded artifacts fed the final
  answer without exposing raw payload.

## Remaining Phase Review

| Phase | Verdict | Adjustment |
|-------|---------|------------|
| Phase 7 | closed | Capability-only planner preplan now replaces bespoke selected-notice fixed-step shell. |
| Phase 8 | moved out | Transport expansion admission is real follow-up work, but no longer part of this workstream's completion gate. |
| Phase 9 | closed for current runtime | Harness trace/eval/schema/docs closeout is sufficient for current selected-notice runtime; residual gap is expansion admission, not runtime correctness. |

## Remaining Phase Findings

### Phase 7

Phase 7 is complete.

Closed corrections:

- Planner-side selected notice fixed-step construction has been removed in favor of
  `CapabilityPlan -> resolver -> WorkflowPlan`.
- `selected_notice_target_surface_ineligible_for_knowledge_followthrough` is preserved.
- `SUPERVISOR_API_MULTI_STEP_WORKFLOW_ENABLED` and workflow run store readiness gates remain in
  place.
- Eval/runtime now prove final answer usage comes from declared artifacts.

### Phase 8

The transport workflow should not be implemented as another scenario branch.

Required corrections:

- Refresh `transport_schedule_lookup` readiness before any admission.
- Define `notice_change_set` producer contract before trying to answer override questions.
- Add eval denominator for baseline-only, override, conflict, stale notice, missing evidence and
  clarification/no-answer.
- Keep public opening gated after Phase 7 parity.

Disposition:

- This work is now tracked by `transport-notice-override-harness-admission`.
- It is no longer a blocker on closing the generic harness runtime workstream itself.

### Phase 9

Phase 9 is complete for the current runtime.

Closed corrections:

- Harness-level artifact graph eval denominator exists for the current selected-notice path.
- Workflow trace gate covers expected artifacts, selected producers, dependencies, projection
  completeness and final answer artifact usage.
- `GAP-LEDGER.md` exists, and architecture closeout is part of this review update.
- Focused Go/Python/eval verification is green.

## Added Planning Requirements

- Phase 8 must not open a public product path without eval and smoke evidence.
- Phase 9 owns harness eval denominator and completion ledger for admitted runtime paths.

## Remaining Risk

The largest remaining design risk is expansion overreach: transport baseline + notice override must
not reopen planner scenario branching or skip artifact admission just because selected-notice
migration is now closed.

The second risk is denominator drift: if future artifact producers open without corresponding
trace/eval assertions, this workstream will regress back to scenario-local correctness only.
