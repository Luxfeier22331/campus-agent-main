---
doc_type: phase_summary
phase: "9"
phase_name: "Campus Services And Notice Tool Eval Expansion"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 9 Summary: Campus Services And Notice Tool Eval Expansion

## Result

Phase 9 adds a shared denominator fixture and deterministic evaluator for the
opened campus-services and notice tool families.

Implemented artifacts:

- `packages/evals/fixtures/tool_family_denominators.v1.json`
- `packages/evals/src/campus_evals/tool_family_denominator.py`
- `tests/evals/tool_family_denominator_suite.py`
- `tests/evals/test_tool_family_denominator.py`
- `packages/evals/fixtures/eval_denominator_registry.v1.json` entries for
  opened service and notice tools

## Coverage

- `service_status_lookup`
- `transport_schedule_lookup`
- `service_guide_lookup`
- `contact_directory_lookup`
- `campus_notice_discover`
- `campus_notice_get`

The evaluator distinguishes:

- `routing_error`
- `read_model_gap`
- `authorization_fail_close`
- `missing_observation`

## Verification

- Phase 8-11 eval suites: passed.
- Case governance, workflow trace gate and intent gate suites: passed.

## Remaining Boundary

This phase does not implement tool runtime behavior or read-model repair. It
freezes the eval denominator and failure taxonomy that runtime/domain owners
must satisfy before opening or changing tool behavior.
