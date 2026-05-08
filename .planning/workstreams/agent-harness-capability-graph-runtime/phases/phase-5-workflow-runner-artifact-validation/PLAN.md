---
doc_type: phase_plan
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Workflow Runner Artifact Validation

## Goal

Ensure workflow execution produces declared artifacts and rejects incomplete or raw outputs.

## Tasks

1. Validate expected artifact kinds after each step.
2. Validate required artifacts before finalization.
3. Add dependency, budget, timeout and retry posture checks.
4. Store artifact ids, producer step ids, result hashes and sanitized source refs in trace.
5. Preserve valid completed terminal states such as `needs_clarification` and `no_answer`.

## Exit Criteria

- Runtime separates step success from artifact completeness.
- Operator/eval trace can inspect artifact graph without raw payload.

## Verification

```bash
cd apps/supervisor-api && go test ./internal/execution ./internal/httpapi
uv run --all-packages python -m unittest tests.contracts.supervisor_execution_fixture_matrix_suite tests.evals.workflow_trace_gate_suite -q
```

## Completion Evidence

- [workflow_plan.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/structuredplanning/workflow_plan.go)
- [request.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/request.go)
- [runtime_decisions.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/execution/runtime_decisions.go)
- [execution_multistep_runner.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/httpapi/execution_multistep_runner.go)
- [answer_multistep_bridge_test.go](/home/reptilian/code/campus-agent/apps/supervisor-api/internal/httpapi/answer_multistep_bridge_test.go)
