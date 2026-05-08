---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: CapabilityPlan Contract And Planner Output

## Goal

Introduce `CapabilityPlan` as the planner's artifact requirement output.

## Tasks

1. Define Go runtime internal `CapabilityPlan` types.
2. Add planner output for selected notice knowledge follow-through.
3. Include required artifacts, constraints, answer policy, grounding policy, budget and fail-close
   posture.
4. Keep existing `WorkflowPlan` behavior during this phase.
5. Add tests for positive selected notice case and negative non-trigger cases.
6. Keep `CapabilityPlan` internal; do not add public/shared contract fields in this phase.

## Exit Criteria

- Planner can express selected notice follow-through as artifact requirements.
- Existing product behavior remains unchanged.
- No public API or shared contract consumer depends on `CapabilityPlan` yet.

## Verification

```bash
cd apps/supervisor-api && go test ./internal/structuredplanning ./internal/runtimepolicy
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite -q
```

## Completion Evidence

- [capability_plan.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/capability_plan.go)
- [capability_plan_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/capability_plan_test.go)
- [planner.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/planner.go)
- [request_policy_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/request_policy_test.go)
