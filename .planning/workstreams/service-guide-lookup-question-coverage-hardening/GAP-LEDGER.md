---
doc_type: gap_ledger
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Service Guide Lookup Question Coverage Hardening

## Completion Audit

| Requirement | Status | Evidence |
| --- | --- | --- |
| Matrix includes at least 24 cases across positive, boundary and fail-close classes | closed | `QUESTION-MATRIX.md` has 33 cases. |
| Every matrix case has exactly one expected outcome | closed | `MATRIX-COVERAGE-AUDIT.md` records 0 ambiguous outcomes. |
| Planner tests prove tool and focus routing | closed | `apps/supervisor-api/internal/structuredplanning/planner_test.go`, `apps/supervisor-api/internal/runtimepolicy/policy_test.go`. |
| Go runtime tests prove focused lookup and fail-close | closed | `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go`. |
| Agent tests prove user-facing answer shaping | closed | `tests/agent/test_campus_services_agent.py`. |
| App-api tests prove browser-facing structured answer rendering | closed | `apps/app-api/test/chat-command.service.core.structured.suite.ts`. |
| Release gate includes explicit coverage counts | closed | `packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`, `tests/evals/service_guide_lookup_release_gate_suite.py`. |
| Public-chat fixture includes representative service-guide cases | closed | `packages/evals/fixtures/public_chat_entry_cases.v1.json`, `tests/evals/public_chat_entry_e2e_suite.py`. |
| Verification evidence is recorded | closed | `STATE.md`, release gate artifact. |

## Accepted Residual Gaps

None in scope.

## Out-Of-Scope Follow-Ups

- Broad public-chat campus-services staging / real-entry E2E remains owned by
  `public-chat-campus-services-e2e-acceptance`.
- New service-guide source collection, selected-write release, PG schema changes and generic RAG
  generic RAG handling remain outside this workstream.

## Reopen Rule

Reopen only if one of these in-scope contracts regresses:

- planner sends a matrix boundary row into `service_guide_lookup`
- planner classifies a positive service-guide row with the wrong `guide_focus`
- runtime substitutes unrelated guide text for a missing requested field
- runtime treats `source_refs` as user-facing action URLs
- agent/app-api exposes raw source locators, release ids or projection internals to browser-facing
  answers
- release gate artifact loses deterministic matrix coverage or representative public-chat subset
  metadata
- a new service-guide focus class is admitted without matrix coverage ownership
