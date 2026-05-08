---
doc_type: audit
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Matrix Coverage Audit

## Final Verdict

This workstream closes the service-guide question coverage denominator as fixture-backed runtime
coverage, not data-plane expansion.

- total cases: 33
- positive `service_guide_lookup` cases: 20
- boundary / non-service-guide cases: 7
- fail-close / guarded cases: 6
- `review_later`: 0
- ambiguous `A or B` outcomes: 0
- data-plane collection/import requested: no
- schema redesign requested: no
- query-time scraping or RAG fallback requested: no
- in-scope medium-or-higher residual gaps: 0

## Fixture Strategy Counts

| Fixture Strategy | Count | Meaning |
| --- | ---: | --- |
| `current_source_truth` | 8 | Use already admitted service-guide source truth. |
| `existing_runtime_fixture` | 7 | Reuse existing Go/Python/eval fixture facts. |
| `synthetic_runtime_fixture` | 9 | Add explicit test projection rows; no source collection/import. |
| `public_chat_fixture` | 2 | Representative public-chat boundary cases already in public entry fixture. |
| `boundary_fixture` | 7 | Planner/guardrail ownership checks; no service-guide runtime lookup. |

## Focus / Boundary Counts

| Class | Count |
| --- | ---: |
| `entry` positive | 5 |
| `procedure` positive | 4 |
| `required_materials` positive | 3 |
| `contact` positive | 3 |
| `office_hours` positive | 2 |
| `eligibility` positive | 2 |
| `full_guide` positive | 1 |
| boundary routing | 7 |
| fail-close / guarded | 6 |

## Phase Verdicts

| Phase | Verdict | Evidence Owner |
| --- | --- | --- |
| Phase 0 | completed | `QUESTION-MATRIX.md`, this audit |
| Phase 1 | completed | `apps/supervisor-api/internal/structuredplanning/planner_test.go`, `apps/supervisor-api/internal/runtimepolicy/policy_test.go` |
| Phase 2 | completed | `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go` |
| Phase 3 | completed | `tests/agent/test_campus_services_agent.py` |
| Phase 4 | completed | `apps/app-api/test/chat-command.service.core.structured.suite.ts` |
| Phase 5 | completed | `packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`, `tests/evals/service_guide_lookup_release_gate_suite.py` |
| Phase 6 | completed | `packages/evals/fixtures/public_chat_entry_cases.v1.json`, `tests/evals/public_chat_entry_e2e_suite.py`, `GAP-LEDGER.md` |

## Layer Coverage Summary

| Layer | Final Status | Coverage |
| --- | --- | --- |
| Planner | completed | Covers all matrix rows with planner ownership, including service-guide focus classification, boundary routing and guarded transaction rejection. |
| Structured runtime | completed | Covers requested-focus lookup, `entry_refs.url` action URL semantics, provenance-only `source_refs`, grouped procedure selection and field-level fail-close. |
| Agent answer shaping | completed | Covers focus-aware answer text, unavailable wording, safe source summaries and internal locator suppression. |
| App-api rendering | completed | Covers representative browser-facing structured service-guide answers and source-safe finalization. |
| Eval / release gate | completed | Gate artifact records matrix counts, focus counts, boundary/fail-close counts and representative public-chat subset mapping. |
| Public-chat subset | completed | Fixture includes representative entry, procedure and required-materials service-guide cases plus existing boundary coverage. |

## Representative Public-Chat Subset

| Public Entry Case | Matrix Case | Coverage Class |
| --- | --- | --- |
| `public-entry-campus-card-loss-guide` | `sg-procedure-campus-card-loss` | procedure |
| `public-entry-academic-calendar-guide-entry` | `sg-entry-calendar-url` | entry |
| `public-entry-public-medical-materials` | `sg-materials-medical-reimbursement` | required_materials |
| `public-entry-vpn-login-entry` | `sg-entry-vpn-login` | entry |

## Case Coverage Status

| Case | Fixture Strategy | Planner | Runtime | Agent | App API | Eval / Public Chat |
| --- | --- | --- | --- | --- | --- | --- |
| sg-entry-calendar-url | existing_runtime_fixture | covered | covered | covered | covered | covered |
| sg-entry-calendar-url-short | existing_runtime_fixture | covered | covered | covered | not_required | not_required |
| sg-entry-vpn-login | existing_runtime_fixture | covered | covered | covered | covered | covered |
| sg-entry-network-auth | existing_runtime_fixture | covered | covered | covered | not_required | not_required |
| sg-entry-information-disclosure | existing_runtime_fixture | covered | covered | covered | not_required | covered |
| sg-procedure-campus-card-loss | current_source_truth | covered | covered | covered | covered | covered |
| sg-procedure-vpn-client | existing_runtime_fixture | covered | covered | covered | covered | covered |
| sg-procedure-transport-booking | synthetic_runtime_fixture | covered | covered | covered | not_required | not_required |
| sg-procedure-dorm-checkin | current_source_truth | covered | covered | covered | not_required | not_required |
| sg-materials-medical-reimbursement | current_source_truth | covered | covered | covered | covered | covered |
| sg-materials-information-disclosure | existing_runtime_fixture | covered | covered | covered | not_required | covered |
| sg-materials-dorm-withdrawal | synthetic_runtime_fixture | covered | covered | not_required | not_required | not_required |
| sg-contact-medical | synthetic_runtime_fixture | covered | covered | covered | not_required | not_required |
| sg-contact-information-disclosure | synthetic_runtime_fixture | covered | covered | covered | not_required | covered |
| sg-contact-campus-card-phone | current_source_truth | covered | covered | covered | not_required | not_required |
| sg-hours-campus-card | synthetic_runtime_fixture | covered | covered | covered | not_required | not_required |
| sg-hours-card-center-colloquial | synthetic_runtime_fixture | covered | covered | covered | not_required | not_required |
| sg-eligibility-campus-card | current_source_truth | covered | covered | covered | not_required | not_required |
| sg-eligibility-medical | current_source_truth | covered | covered | covered | not_required | not_required |
| sg-full-guide-campus-card | current_source_truth | covered | covered | covered | not_required | not_required |
| boundary-calendar-week | public_chat_fixture | covered | not_required | not_required | not_required | covered |
| boundary-calendar-holiday | public_chat_fixture | covered | not_required | not_required | not_required | covered |
| boundary-transport-next | boundary_fixture | covered | not_required | not_required | not_required | covered |
| boundary-status-card-center | boundary_fixture | covered | not_required | not_required | not_required | covered |
| boundary-contact-directory | boundary_fixture | covered | not_required | not_required | not_required | covered |
| boundary-contact-directory-information-disclosure | boundary_fixture | covered | not_required | not_required | not_required | covered |
| boundary-notice-original | boundary_fixture | covered | not_required | not_required | not_required | covered |
| fail-entry-source-only | existing_runtime_fixture | not_required | covered | covered | not_required | covered |
| fail-contact-department-only | synthetic_runtime_fixture | not_required | covered | covered | not_required | covered |
| fail-office-hours-missing | synthetic_runtime_fixture | not_required | covered | covered | not_required | not_required |
| fail-materials-missing | synthetic_runtime_fixture | not_required | covered | covered | not_required | not_required |
| fail-eligibility-missing | synthetic_runtime_fixture | not_required | covered | covered | not_required | not_required |
| fail-transaction-request | boundary_fixture | covered | not_required | covered | covered | covered |

## Release Gate Artifact Contract

`packages/evals/src/campus_evals/service_guide_lookup_release_gate.py` writes:

- `coverage.matrix.total_cases = 33`
- `coverage.matrix.positive_service_guide_cases = 20`
- `coverage.matrix.boundary_cases = 7`
- `coverage.matrix.fail_close_cases = 6`
- `coverage.matrix.focus_counts` for all seven positive guide focuses
- `coverage.public_chat_subset.case_ids` for representative public entry cases
- `coverage.public_chat_subset.matrix_case_ids` mapping those public entry cases to matrix rows

## Non-Goals Confirmed

- No service-guide source-truth import.
- No official-web or handbook recollection.
- No PG projection schema change.
- No generic RAG fallback.
- No public-chat broad campus-services opening work.
