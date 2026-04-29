---
doc_type: phase_summary
phase: "13"
phase_name: "Eval Operations Governance"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 13 Summary: Eval Operations Governance

## Result

Phase 13 adds machine-readable eval operations policy, a deterministic policy
evaluator and an active runbook for long-term eval runtime governance.

Implemented artifacts:

- `packages/evals/fixtures/eval_operations_profile_policy.v1.json`
- `packages/evals/src/campus_evals/eval_operations_governance.py`
- `tests/evals/eval_operations_governance_suite.py`
- `tests/evals/test_eval_operations_governance.py`
- `docs/runbooks/eval-operations-governance.md`
- denominator registry entry for `eval_operations_governance`

## Coverage

- Profile case/provider budget.
- Timeout and retry policy.
- Allowed gate mode.
- Failure, skip, quarantine and repair disposition requirements.
- Quarantine readmission rule.
- Artifact retention.
- Required case-set, policy and runtime version summary fields.

## Verification

- Eval operations governance suite: passed.
- Case governance suite: passed.
- Targeted ruff check and format check: passed.
- Docs lint: passed.

## Boundary

This phase does not make all eval lanes PR hard gates and does not make
supplemental provider availability canonical deterministic truth. Operations
policy governs eval runtime evidence only.
