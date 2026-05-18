---
doc_type: contract
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Machine Review Gate

`selected_write_requires_review` is implemented as deterministic machine field review for this
workstream.

## Gate Inputs

- target inventory `required_fields`
- target inventory `required_evidence`
- typed candidate extraction
- quality gate decision
- source refs: source URL, raw asset id, raw version id and source object keys

## Ready Rule

A selected-write candidate is ready only when all of the following are true:

- it is `candidate_only` with a supported selected-write target
- target inventory entry exists
- review fields include both `required_fields` and `required_evidence`
- every review field is `present`
- typed candidate schema and typed candidate payload exist
- quality gate decision is `pass`
- run admission was not `legacy_contract_excluded`
- no review manifest explicitly rejected or requested more evidence

An absent human approval manifest does not block readiness when machine field review passes.

## Blocked Rule

The gate fails closed with machine reasons:

- `target_inventory_required_fields_missing`
- `machine_review_candidate_failed_quality_gate`
- `machine_review_candidate_missing_typed_candidate`
- `machine_field_review_blocked`
- `review_marked_needs_more_evidence`
- `run_admission_decision_excluded`

Release task admission and selected-write execution also require `fieldStatus` and
`requiredFields` in the release task evidence.
