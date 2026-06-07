---
doc_type: phase-audit
status: completed
created: 2026-05-07
updated: 2026-05-07
phase: 0
---

# Phase 0 Audit: Current Design And Boundary Freeze

## Phase Goal

Freeze the current implementation facts before changing
`academic_calendar_lookup`. Phase 0 does not implement the capability. It
defines the owners, current behavior, known gaps and Phase 1 contract direction.

## Boundary Decision

This workstream owns capability completion for:

- date to teaching week
- named calendar event range
- day status
- class-day pattern / makeup class
- term window
- source-backed answer rendering
- routing denominator and eval

This workstream does not own:

- restoring `calendar-agent`
- renaming `calendar/academic_calendar`
- query-time scanning of raw official-web pages, notice HTML or image assets
- generic RAG fallback for calendar facts
- personal timetable, course schedule or concrete exam arrangement features
- service-guide entry questions such as `校历在哪里看`

## Current File Owners

Runtime registry and policy:

- `configs/runtime/agents.v1.json`
- `configs/runtime/tools.v1.json`
- `configs/runtime/intent-policy.v1.json`
- `apps/supervisor-api/internal/runtimepolicy/*`

Contract and DTOs:

- `packages/contracts/src/campus_contracts/models_tools.py`
- `packages/contracts/src/campus_contracts/models_shared.py`
- `docs/contracts/schemas/supervisor-execution.openapi.yaml`
- `scripts/generate_supervisor_execution_contracts.py`
- generated artifacts under `apps/app-api`,
  `apps/supervisor-api/internal/contracts` and
  `apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/generated`

Campus services agent adapter:

- `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
- `packages/campus-services-agent/src/campus_services_agent/query_service.py`
- `packages/campus-services-agent/src/campus_services_agent/http_query_service.py`
- `packages/campus-services-agent/src/campus_services_agent/academic_calendar_adapter.py`

Go structured query runtime:

- `apps/supervisor-api/internal/structuredquery/academic_calendar.go`
- `apps/supervisor-api/internal/structuredquery/academic_calendar_types.go`
- `apps/supervisor-api/internal/structuredquery/academic_calendar_store.go`
- `apps/supervisor-api/internal/httpapi/structured_query_handlers.go`
- `apps/supervisor-api/internal/httpapi/structured_single_step.go`

Data plane and publication:

- `configs/ingestion/calendar/academic_calendar/source-truth.v1.json`
- `configs/ingestion/calendar/academic_calendar/curated-academic-calendars/central-minzu-2025-2026.v1.json`
- `packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_academic_calendar_projection.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
- `scripts/publish_academic_calendar_projection.py`

Eval, tests and smoke:

- `tests/agent/campus_services_academic_calendar_suite.py`
- `tests/contracts/contract_models_services_and_notice_suite.py`
- `tests/ingestion/test_academic_calendar_projection.py`
- `tests/test_publish_academic_calendar_projection.py`
- `apps/supervisor-api/internal/structuredquery/runtime_academic_calendar_test.go`
- `apps/supervisor-api/internal/structuredplanning/planner_test.go`
- `scripts/academic_calendar_selected_write_runtime_smoke.py`
- `scripts/supervisor_runtime_process_smoke.py`
- `tests/test_supervisor_runtime_process_smoke.py`
- `tests/evals/multi_agent_product_path_eval_gate_profile_suite.py`

## Current Implementation Facts

Runtime ownership:

- `academic_calendar_lookup` is owned by `campus-services-agent`.
- The capability is `campus_services`.
- The data-plane target remains `calendar/academic_calendar`.
- The internal query route is `/internal/query/calendar/academic-calendar`.

Current payload contract:

- `query_text`
- `temporal_query`
- `academic_year_label`
- `date_hint`

Current result contract:

- `requested_date`
- `resolved_date`
- `academic_year_label`
- `term_label`
- `week_index`
- `day_kind`
- `class_day_pattern`
- `is_makeup_class`
- `holiday_name`
- `source_refs`
- `queried_time_anchor`
- `effective_from`
- `effective_until`
- `fail_close_reason`

Current Go resolver behavior:

- loads current `calendar/academic_calendar` projection bundle
- uses `target_date`, `date_hint`, extracted ISO date or trusted current time
  as target date
- detects teaching-week queries by `教学周` / `第几周`
- detects holiday queries by keyword
- detects makeup queries by keyword
- uses record date containment and score sorting
- uses inclusive source display ranges and end-exclusive event intervals after
  Phase 2
- fail-closes when source truth or source family is unavailable

Current source truth:

- curated source schema: `official_web_curated_academic_calendar.v1`
- projection schema: `academic_calendar_projection.v1`
- configured current source count: `49`
- current public source refs include the MUC official calendar page and image
  evidence
- selected-write candidates can also publish into `calendar/academic_calendar`

## Currently Supported Questions

Supported by existing code/tests:

- `今天第几教学周`
- date-hinted exact date-to-week lookup, currently covered by
  `2026-05-04 是第几教学周`
- `五一放几天`
- `哪周补课`
- `2026-05-09 要补课吗`
- `2026-05-07 是第几教学周`
- `劳动节放假怎么安排`
- `2026-05-01 上课吗`
- `本学期什么时候结束`
- `4月25日上周几的课` is routed to the tool by planner tests, though runtime
  still depends on a matching date-hinted or extracted payload

Supported smoke probes:

- `teaching_week_current`
- `holiday_current`
- `makeup_class_current`

## Currently Unsupported Or Unsafe Questions

Unsupported or not reliably supported today:

- `今年春假是什么时候` resolves to source-backed `not_found`
- `2026 年春假是哪几天`
- `2026-05-04 是春假吗`
- `五一期间本科生停课吗`
- audience-specific calendar facts such as undergraduate vs graduate

Should route elsewhere:

- `找春假通知原文` -> notice lookup
- `下载校历` -> service guide or source card, depending user intent
- `校历在哪里看` -> service guide
- personal timetable queries -> not covered by current product scope
- concrete exam arrangements -> not covered unless admitted into calendar
  projection

## Spring Break Source Truth Finding

The current curated 2025-2026 calendar artifact contains:

- `2026-04-27` as the start of a teaching-week record
- `2026-05-05` as the end of `劳动节假期`
- `寒假`
- `暑假`
- `劳动节假期`
- a `2026-05-09` makeup class record

It does not contain an explicit `春假` event record.

The official-web academic-calendar extractor currently recognizes holiday text
matching:

```text
劳动节|国庆|元旦|清明|端午|中秋
```

It does not recognize `春假`.

Decision:

- Phase 2 must return source-backed `not_found` for `今年春假是什么时候`
  unless source truth names the event.
- The implementation must not infer `春假` from `春季社会实践周` or generic
  course-suspension text unless a separate documented alias rule is admitted.

## Phase 1 Contract Decision

Phase 1 should extend the DTOs with explicit query and event fields instead of
overloading current date/holiday fields.

Payload / normalized-query direction:

- `query_kind`
- `event_query`
- `target_date`
- keep `temporal_query` as request-level temporal intent
- `audience`
- optional `term_label`

Do not add a client-controlled free-form `time_anchor` to the payload. The
trusted execution anchor remains server-owned and is reported through
`queried_time_anchor`.

Result direction:

- `event_name`
- `event_type`
- `event_aliases`
- `event_start_date`
- `event_end_date_exclusive`
- `display_start_date`
- `display_end_date`
- `applies_to`
- `source_title`
- `source_url`
- `calendar_record_id`
- optional `conflict_refs`

Keep current fields during the same contract evolution:

- `resolved_date`
- `week_index`
- `holiday_name`
- `class_day_pattern`
- `is_makeup_class`
- `source_refs`

Do not use `effective_from` / `effective_until` as named event range semantics.
Those fields should remain lifecycle/effective-window style metadata until they
are explicitly retired or redefined.

## Phase 2 Data Decision

The projection should support first-class logical record families:

- term windows
- teaching week/day facts
- named calendar events
- class-day overrides

The existing `academic_calendar_records` list may remain as a transitional
wire/storage container if each record receives explicit fields that identify
its fact family and event semantics.

Recommended interval model:

- internal event interval: start inclusive / end exclusive
- display range: natural Chinese inclusive end date when source presents one
- tests must cover start date, display end date and day after display end date

## Phase 3 Resolver Decision

The resolver should not depend on prompt/model inference for calendar facts.
It should deterministically select one of:

- `date_week`
- `named_event_range`
- `day_status`
- `class_day_pattern`
- `term_window`

Resolver failure policy:

- missing source refs -> fail closed
- unsupported query kind -> invalid request
- conflicting source-backed facts -> fail closed with conflict refs
- missing `春假` event -> source-backed `not_found` until support is added

## Existing Verification Baseline

Current relevant tests:

- Go runtime:
  `cd apps/supervisor-api && go test -count=1 ./internal/structuredquery`
- Go planner/runtime policy:
  `cd apps/supervisor-api && go test -count=1 ./internal/structuredplanning ./internal/runtimepolicy`
- Python adapter/contracts:

  ```bash
  uv run --all-packages python -m unittest \
    tests.agent.campus_services_academic_calendar_suite \
    tests.contracts.contract_models_services_and_notice_suite -q
  ```

- Calendar projection:

  ```bash
  uv run --all-packages python -m unittest \
    tests.ingestion.test_academic_calendar_projection \
    tests.test_publish_academic_calendar_projection -q
  ```

## Phase 0 Exit Checklist

- Current internal design is documented in `CURRENT-DESIGN.md`.
- Planning review is documented in `PLANNING-REVIEW.md`.
- This audit records code owners, test owners and current source truth.
- Current supported and unsupported questions are explicit.
- The `春假` blocker is explicit and source-backed.
- Phase 1 contract direction is frozen enough to implement.
