---
doc_type: phase_plan
workstream: service-guide-lookup-question-coverage-hardening
phase: phase-0-scope-and-matrix-freeze
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Scope And Matrix Freeze

## Goal

Freeze the `service_guide_lookup` question denominator before implementation so each future code
change maps to an explicit user question, expected tool/focus, answer contract and verification
layer.

## Inputs To Inspect

- `.planning/workstreams/service-guide-lookup-question-coverage-hardening/QUESTION-MATRIX.md`
- `apps/supervisor-api/internal/structuredplanning/planner.go`
- `apps/supervisor-api/internal/structuredplanning/planner_test.go`
- `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go`
- `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
- `tests/agent/test_campus_services_agent.py`
- `apps/app-api/test/chat-command.service.core.structured.suite.ts`
- `packages/evals/fixtures/public_chat_entry_cases.v1.json`
- `packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`

## Tasks

1. Review the matrix against existing fixtures and classify every case by fixture strategy:
   `current_source_truth`, `existing_runtime_fixture`, `synthetic_runtime_fixture`,
   `public_chat_fixture`, or `boundary_fixture`.
2. Add `MATRIX-COVERAGE-AUDIT.md`.
   - Count cases by focus and boundary class.
   - Map each case to test/eval owners.
   - Mark each case as `covered_existing`, `needs_test`, or `needs_behavior_fix`.
   - Record that `synthetic_runtime_fixture` cases do not request source collection/import.
3. Confirm no `review_later` bucket exists.
4. Confirm no matrix case contains an ambiguous `A or B` expected outcome.
5. Confirm no case requires query-time scraping, RAG fallback or schema redesign.
6. Update `STATE.md` with Phase 0 completion evidence.

## Exit Criteria

- The matrix has at least 24 cases.
- Every case has a clear owner layer, fixture strategy and exactly one expected outcome.
- Any source-data-dependent gap is out of scope for this workstream and not hidden as a runtime
  TODO.

## Completion Evidence

- `MATRIX-COVERAGE-AUDIT.md` created.
- All 33 matrix cases have fixture strategy and layer status.
- No source collection/import, schema redesign, query-time scraping, RAG fallback or
  `review_later` bucket remains in scope.

## Verification

```bash
pnpm exec markdownlint-cli2 .planning/workstreams/service-guide-lookup-question-coverage-hardening/README.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/REQUIREMENTS.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/ROADMAP.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/STATE.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/QUESTION-MATRIX.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/phases/phase-0-scope-and-matrix-freeze/PLAN.md .planning/WORKSTREAMS.md
git diff --check -- .planning/workstreams/service-guide-lookup-question-coverage-hardening .planning/WORKSTREAMS.md
```
