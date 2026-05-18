---
doc_type: phase_plan
workstream: service-guide-lookup-question-coverage-hardening
phase: phase-5-eval-and-release-gate-integration
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 5 Plan: Eval And Release Gate Integration

## Goal

Make service-guide question coverage durable in `packages/evals` and release-gate artifacts.

## Inputs To Inspect

- `packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`
- `tests/evals/service_guide_lookup_release_gate_suite.py`
- `packages/evals/fixtures/public_chat_entry_cases.v1.json`
- `tests/evals/public_chat_entry_e2e_suite.py`
- `packages/evals/README.md`
- `QUESTION-MATRIX.md`

## Tasks

1. Add or derive deterministic service-guide gate cases from the matrix.
2. Extend release-gate report with coverage counts by:
   - guide focus
   - boundary class
   - fail-close class
3. Add tests proving the gate fails on:
   - entry query returning a procedure dump
   - entry query using source-only provenance URL
   - missing requested field returning unrelated guide content
4. Add representative public-chat fixture cases for entry, procedure, materials and boundary only;
   do not duplicate broad public-chat campus-services opening coverage.
5. Update `MATRIX-COVERAGE-AUDIT.md` eval/public-chat rows.
6. Update eval docs only if command/profile semantics change.
7. Update `STATE.md` with Phase 5 evidence.

## Exit Criteria

- `service-guide-lookup` gate is deterministic and fails on focus/source drift.
- Public-chat fixture covers service-guide behavior without taking over broad campus-services E2E
  ownership.
- Eval artifacts are machine-readable and include coverage counts.
- Gate artifacts distinguish full matrix deterministic coverage from representative public-chat
  smoke cases.

## Completion Evidence

- Release gate artifact now includes `coverage.matrix` with total, positive, boundary, fail-close
  and guide-focus counts.
- Release gate artifact now includes `coverage.public_chat_subset` with public entry case ids and
  corresponding matrix case ids.
- Release gate tests verify the artifact contract, selected-write runtime smoke wiring and preview
  runtime verification failure propagation.

## Verification

```bash
uv run --all-packages python -m unittest tests.evals.service_guide_lookup_release_gate_suite tests.evals.public_chat_entry_e2e_suite -q
uv run --all-packages python -m scripts.eval_gate accept --profile service-guide-lookup --json
uv run --all-packages ruff check packages/evals/src/campus_evals/service_guide_lookup_release_gate.py tests/evals/service_guide_lookup_release_gate_suite.py tests/evals/public_chat_entry_e2e_suite.py
git diff --check -- packages/evals tests/evals .planning/workstreams/service-guide-lookup-question-coverage-hardening
```
