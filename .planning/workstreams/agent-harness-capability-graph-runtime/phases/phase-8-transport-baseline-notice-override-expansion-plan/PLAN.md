---
doc_type: phase_plan
status: planned
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 8 Plan: Transport Baseline + Notice Override Expansion Plan

## Goal

Prepare the first new composite capability through artifact graph admission.

This phase remains planning/admission only unless Phase 7 parity has completed.

## Tasks

1. Refresh readiness evidence for `transport_schedule_lookup`.
2. Define `NoticeChangeSet` producer contract for schedule/status override notices.
3. Define when transport questions require notice override artifact.
4. Add eval cases:
   - baseline only
   - baseline + temporary notice
   - conflict
   - stale notice
   - missing evidence
   - no answer / clarification
5. Keep public opening behind explicit gate.
6. Do not add planner scenario branches for this expansion.

## Exit Criteria

- Expansion can be implemented without planner scenario if-else.
- Product opening remains gated by eval/smoke evidence.

## Verification

```bash
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent tests.evals.workflow_trace_gate_suite -q
cd apps/supervisor-api && go test ./internal/structuredplanning ./internal/execution ./internal/httpapi
```
