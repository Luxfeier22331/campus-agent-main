---
doc_type: runbook
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Eval Operations Governance

This runbook freezes the operating rules for repo-owned eval profiles. It is
about eval runtime governance only; it does not author domain truth and does not
turn supplemental provider availability into deterministic truth.

## Source Of Truth

- Machine-readable policy:
  `packages/evals/fixtures/eval_operations_profile_policy.v1.json`
- Policy evaluator:
  `campus_evals.eval_operations_governance`
- Profile artifact runner:
  `campus_evals.eval_profile_gate`
- Denominator registry:
  `packages/evals/fixtures/eval_denominator_registry.v1.json`

## Required Profile Fields

Every eval operations profile must define:

- case and provider-call budget
- runtime timeout, retry limit, pacing and breaker policy
- artifact and promoted-artifact retention
- allowed gate modes
- failure disposition labels
- quarantine policy and readmission rule
- required version summary fields

## Gate Modes

Allowed gate modes are explicit per profile. Do not promote a profile into a PR
hard gate unless the policy file names that mode.

Current default posture:

- `manual`: local or operator-triggered evidence
- `scheduled`: recurring non-blocking regression evidence
- `release_gate`: explicit release or opening evidence

## Deterministic Product-Path Gates

`multi-agent-product-path` is the deterministic acceptance gate for the
supervisor-led multi-agent product path. Run it with:

```bash
uv run --all-packages python -m scripts.eval_gate accept \
  --profile multi-agent-product-path \
  --output-dir .tmp/evals/multi-agent-product-path-smoke \
  --json
```

The gate covers:

- workflow trace evaluator and fixture denominator
- tool-family denominator evaluator and fixture denominator
- public-chat product-path evaluator and fixture denominator
- targeted supervisor-api, app-api and protected-panel-web test lanes

The gate does not start local live processes, does not run Docker smoke, does
not mutate serving admission, does not introduce an Agents SDK runtime, and does
not produce live case-results artifacts for operator publish dry-run.

Failure handling:

- fixture or evaluator failure: fix the eval-owned case truth, evaluator
  semantics or sanitized artifact contract first
- supervisor/app-api/panel targeted lane failure: fix the owning runtime surface
  before rerunning the gate
- missing or malformed `multi-agent-product-path-gate.json`: treat as a gate
  implementation failure

## Failure Disposition

Every failed, skipped, quarantined or repaired case must have an auditable
disposition in the eval observation.

Accepted dispositions are profile-owned. A failed case without a disposition is
an operations failure even if the deterministic evaluator can explain the
technical assertion failure.

## Quarantine

Quarantine is not a way to hide regressions. A quarantined case requires:

- profile policy allowing quarantine
- a max quarantine window
- a readmission rule
- case-level readmission evidence in the observation

Cases without readmission evidence must remain failed or skipped, not
quarantined.

## Retention

Artifacts older than the profile retention window must be cleaned or promoted.
Promoted artifacts use the longer promoted-artifact retention window and must be
linked from release evidence or a phase summary.

## Drift Evidence

Every accepted operations observation must include all required version fields.
The current default fields are:

- `case_set_version`
- `policy_artifact`
- `runtime_version`

Missing version fields are reported as version drift.

## Artifact-Derived Observations

Operations governance observations should be derived from real eval artifacts
where possible. For Phase 8-13 observation-backed profiles, use
`scripts.eval_gate accept --profile <profile> --observations-path <file>` to
write `profile-report.json`, then pass those artifacts into
`eval-operations-governance` via repeated `--artifact-path`.

The derived observation reads:

- `profile_id` from the profile artifact
- `cases_run`, failure count and case dispositions from `summary` and
  `sanitized_results`
- `version_summary` from the profile artifact

Do not hand-author compliant operations observations when a profile artifact
exists. Hand-authored observations are only acceptable for unit tests and
pre-runtime planning fixtures.
