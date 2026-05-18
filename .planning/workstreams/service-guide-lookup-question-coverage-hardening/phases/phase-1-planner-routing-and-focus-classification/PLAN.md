---
doc_type: phase_plan
workstream: service-guide-lookup-question-coverage-hardening
phase: phase-1-planner-routing-and-focus-classification
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 1 Plan: Planner Routing And Focus Classification

## Goal

Make `supervisor-api` deterministically classify service-guide user goals into the correct
`service_guide_lookup` `guide_focus`, while preserving boundary routing to calendar, transport,
status, contact-directory and notice owners.

## Inputs To Inspect

- `apps/supervisor-api/internal/structuredplanning/planner.go`
- `apps/supervisor-api/internal/structuredplanning/planner_test.go`
- `apps/supervisor-api/internal/runtimepolicy/*`
- `configs/runtime/tools.v1.json`
- `configs/runtime/agents.v1.json`
- `QUESTION-MATRIX.md`

## Tasks

1. Add planner golden cases for all matrix cases whose layer includes `planner`.
2. Implement or adjust focus classification for:
   - entry URL/link/location questions
   - procedure/how-to questions
   - required material/form questions
   - contact/phone/email questions
   - office-hour/time questions
   - eligibility/audience questions
   - broad full-guide questions
3. Add boundary tests proving calendar/schedule/status/contact-directory/notice questions route to
   their explicit matrix owners and do not route to `service_guide_lookup`.
4. Add guardrail tests for transaction requests such as "帮我预约".
5. Update `MATRIX-COVERAGE-AUDIT.md` planner rows.
6. Update `STATE.md` with Phase 1 evidence.

## Exit Criteria

- Planner produces expected `selected_target`, `payload_kind`, allowed tool and payload fields.
- Boundary cases remain outside `service_guide_lookup`.
- Guarded transaction cases do not produce a service-guide handoff.
- No new tool or capability is opened.

## Completion Evidence

- Added planner golden cases for Phase 1 matrix rows, including entry, materials, contact,
  office-hours, eligibility, full-guide, boundary and guarded transaction requests.
- Updated planner focus classification for:
  - academic-calendar entry URL/link/location questions
  - login entry questions
  - colloquial office-hour questions
  - eligibility/audience questions
  - broad full-guide questions
  - application-scoped contact questions
- Updated runtime policy signals and capability tests so newly covered service-guide questions are
  inferred as `campus_services` before planner execution.
- Preserved boundary routing for academic calendar facts, transport schedule, service status,
  contact directory and notice discovery.

## Verification

```bash
cd apps/supervisor-api && go test -count=1 ./internal/structuredplanning ./internal/runtimepolicy -run 'TestPlanGoldenCases|TestPlanSkipsTransactionalStructuredRequests|TestResolveCapabilityUsesIntentPolicyArtifactSignals'
git diff --check -- apps/supervisor-api/internal/structuredplanning .planning/workstreams/service-guide-lookup-question-coverage-hardening
```
