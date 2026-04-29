---
doc_type: phase_summary
phase: "11"
phase_name: "Authorization / Privacy / Restricted Surface Eval"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 11 Summary: Authorization / Privacy / Restricted Surface Eval

## Result

Phase 11 adds deterministic restricted-surface authorization and privacy eval coverage.

Implemented artifacts:

- `packages/evals/fixtures/authz_privacy_cases.v1.json`
- `packages/evals/src/campus_evals/authz_privacy_eval.py`
- `tests/evals/authz_privacy_eval_suite.py`
- `tests/evals/test_authz_privacy_eval.py`
- `packages/evals/fixtures/eval_denominator_registry.v1.json` entry for `restricted_authz_privacy`
- Extended raw trace key rejection in `packages/evals/src/campus_evals/models.py`

## Coverage

- Restricted notice deny fail-close.
- Policy unavailable fail-close.
- Capability closed fail-close.
- Authorization summary matching.
- Artifact minimization guard against JWT, cookies, auth envelopes, raw auth
  material and restricted/raw payload keys.
- Failure-class separation for restricted deny mismatch, closed scope mismatch
  and policy unavailable mismatch.

## Verification

- Phase 8-11 eval suites: passed.
- Case governance, workflow trace gate and intent gate suites: passed.

## Remaining Boundary

This phase does not open restricted user-visible surfaces. It only establishes
eval-owned fail-close, minimization and redaction gates for any restricted
surface that later enters runtime evaluation.
