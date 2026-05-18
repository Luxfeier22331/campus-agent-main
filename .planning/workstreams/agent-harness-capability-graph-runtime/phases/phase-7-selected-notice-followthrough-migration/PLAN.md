---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 7 Plan: Selected Notice Follow-Through Migration

## Goal

Replace the current hand-written selected notice multi-step path with harness-generated workflow.

## Tasks

1. Emit `CapabilityPlan` for eligible selected regulation-like notice follow-through.
2. Resolve to notice context producer and RAG grounding/synthesis step.
3. Preserve ineligible target-surface fail-close:
   `selected_notice_target_surface_ineligible_for_knowledge_followthrough`.
4. Preserve `SUPERVISOR_API_MULTI_STEP_WORKFLOW_ENABLED` and workflow run store readiness gate.
5. Update Go/Python/eval tests to assert artifact-driven plan and final answer usage.

## Exit Criteria

- Behavior remains parity-equivalent.
- Planner no longer needs bespoke fixed-step constructor for this path.

## Verification

```bash
cd apps/supervisor-api && go test ./internal/structuredplanning ./internal/runtimepolicy ./internal/execution ./internal/httpapi
uv run --all-packages python -m unittest tests.evals.workflow_trace_gate_suite tests.test_supervisor_runtime_process_smoke -q
```
