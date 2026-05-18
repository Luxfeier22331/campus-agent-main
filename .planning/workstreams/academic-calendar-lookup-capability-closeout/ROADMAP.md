---
doc_type: roadmap
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Roadmap: Academic Calendar Lookup Capability Closeout

## Overview

Execution order:

```text
design audit -> contract -> data model -> resolver -> routing -> answer
-> eval -> E2E -> closeout
```

This workstream extends the existing `academic_calendar_lookup` capability. It
does not reopen agent ownership or data-plane collection naming.

## Phases

- [x] **Phase 0: Current Design Audit And Boundary Freeze**
  - Finish the implementation inventory across contract, data plane, Go
    structured query, Python adapter, planner and eval
  - Record current supported examples and unsupported examples
  - Freeze non-goals: no standalone `calendar-agent`, no query-time raw source
    scan, no generic RAG fallback
  - Confirm whether existing source truth can answer `今年春假是什么时候`
  - Produce `PHASE-0-AUDIT.md` with current file owners, existing tests,
    supported examples, unsupported examples and required contract decisions

- [x] **Phase 1: Contract Shape For Calendar Fact Queries**
  - Add `query_kind`, `event_query`, `target_date`, `audience` and optional
    `term_label` to the payload / normalized-query shape
  - Keep `temporal_query` as request-level temporal intent and keep trusted
    execution anchoring server-owned via result `queried_time_anchor`
  - Add event range and source display fields to the result
  - Preserve existing direct week fields for current callers
  - Update OpenAPI only if supervisor execution wire schema changes
  - Regenerate artifacts with
    `scripts.generate_supervisor_execution_contracts` when OpenAPI changes
  - Keep `packages/contracts`, Go structured-query structs and Python HTTP
    decoder synchronized
  - Add contract model tests

- [x] **Phase 2: Projection Schema And Curated Source Truth Upgrade**
  - Split logical facts into term windows, teaching day/week facts, named
    events and class-day overrides
  - Add source-backed explicit event records for `春假` if supported by
    official calendar/notice evidence
  - Extend official-web selected-write extraction to preserve named calendar
    events beyond current holiday regex
  - Do not infer spring break from `春季社会实践周` unless an explicit alias rule
    is admitted and documented
  - Define interval semantics as start inclusive / end exclusive internally
    while preserving user-facing display end dates
  - Add projection validation for invalid ranges, source-less records and
    overlapping conflicting events
  - Update publisher and release-ready checks

- [x] **Phase 3: Structured Query Resolver Upgrade**
  - Implement deterministic `query_kind` resolution
  - Resolve date-week, named-event range, day status, class-day pattern and
    term-window queries separately
  - Use explicit event aliases rather than only `holiday_name` substring match
  - Fail closed on missing source, conflicting records or unsupported query
    kind
  - Add Go unit tests for boundaries and conflict cases

- [x] **Phase 4: Campus Services Adapter And Answer Contract**
  - Update Python HTTP decoding for the extended result contract
  - Render event ranges, teaching-week facts, day status and class-day patterns
    without leaking projection internals
  - Require source refs for `resolved_current`
  - Return clarification for underspecified queries that cannot be safely
    anchored
  - Add focused Python adapter tests

- [x] **Phase 5: Planner And Tool Selection Denominator**
  - Update intent policy and planner tests for calendar fact questions
  - Add negative routing for notice original/source-card queries
  - Add negative routing for service guide entry questions
  - Add examples that distinguish `今年春假是什么时候` from `找春假通知原文`
  - Ensure `requested_capability=campus_services` still admits the tool but
    standalone `academic_calendar` remains invalid

- [x] **Phase 6: Eval Profiles And Regression Fixtures**
  - Add tool-selection eval cases
  - Add payload-normalization eval cases
  - Add structured-query result eval cases
  - Add answer contract eval cases
  - Add interval boundary cases for start date, display end date and end
    exclusive semantics
  - Add no-source and conflict fail-close cases

- [x] **Phase 7: Public Chat E2E Acceptance**
  - Add public/chat E2E denominator cases for:
    - `2026-05-07 是第几教学周`
    - `劳动节放假怎么安排`
  - Assert expected target `campus-services-agent`
  - Assert response contract requires answer text and safe source URL
  - Keep real browser/staging public-chat observation owned by
    `public-chat-campus-services-e2e-acceptance`

- [x] **Phase 8: Doctor, Docs And Closeout**
  - Add projection/read-model doctor checks for record counts, missing sources,
    invalid ranges and unresolved aliases
  - Update campus-services, execution, data-plane and contract docs
  - Update this workstream's `STATE.md` and registry status
  - Run focused Go/Python/docs verification

## Verification Plan

Focused commands:

```bash
cd apps/supervisor-api
go test -count=1 ./internal/structuredquery ./internal/httpapi
go test -count=1 ./internal/structuredplanning ./internal/runtimepolicy
uv run --all-packages python -m unittest \
  tests.agent.campus_services_academic_calendar_suite \
  tests.contracts.contract_models_services_and_notice_suite -q
uv run --all-packages python -m unittest \
  tests.ingestion.test_academic_calendar_projection \
  tests.test_publish_academic_calendar_projection -q
uv run --all-packages ruff check \
  packages/campus-services-agent tests/agent tests/contracts tests/ingestion
uv run --all-packages ruff format \
  packages/campus-services-agent tests/agent tests/contracts tests/ingestion \
  --check
pnpm docs:lint
```

Product-path verification:

```bash
uv run --all-packages python -m unittest \
  tests.evals.public_chat_entry_e2e_suite -q
```

Use `public-chat-campus-services-e2e-acceptance` for real browser/staging
entry observations. This workstream only claims deterministic denominator and
fixture coverage.

## Exit Criteria

- Contract can represent date-week, event-range, day-status, class-day-pattern
  and term-window answers
- `今年春假是什么时候` is explicitly unsupported with source-backed not-found
  evidence until a future source record names `春假`
- Runtime resolver has deterministic tests for interval boundaries
- Planner routes calendar fact queries and rejects notice/service-guide
  confusions
- Public/chat has at least two calendar fact E2E cases
- Documentation and registry agree on the final boundary
