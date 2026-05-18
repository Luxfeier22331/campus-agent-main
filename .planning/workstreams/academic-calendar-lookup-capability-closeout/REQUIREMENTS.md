---
doc_type: requirements
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Requirements: Academic Calendar Lookup Capability Closeout

## Goal

Make `academic_calendar_lookup` a production-ready structured calendar fact
tool under `campus-services-agent`.

The tool must answer calendar facts from the `calendar/academic_calendar`
projection-backed typed read model. It must not query raw source pages,
generic retrieval chunks, notice HTML, or image assets at runtime.

Relative date wording is supported only after the planner or caller resolves it
into `target_date` / `date_hint` or the server trusted current date. This
workstream does not add natural-language relative date arithmetic such as
`下周一`.

This workstream assumes the runtime owner is already correct. It does not
reopen the completed `calendar-agent` retirement decision.

## Functional Requirements

### R1: Date To Teaching Week

The tool must answer exact date-to-week questions.

Examples:

- `2026-05-07 是第几教学周`
- `今天第几教学周`

Required output facts:

- resolved date
- academic year
- term label
- week index
- source refs

### R2: Named Calendar Event Range

The tool must answer named event range questions.

Examples:

- `今年春假是什么时候`
- `2026 年春假是哪几天`
- `劳动节放假怎么安排`
- `暑假什么时候开始`

Required output facts:

- event name
- event type
- display start date
- display end date
- canonical interval start
- canonical interval end exclusive
- applies-to audience when available
- source refs

### R3: Day Status

The tool must answer whether a date is teaching, holiday, suspended, or
otherwise governed by a known calendar event.

Examples:

- `2026-05-01 上课吗`
- `2026-05-04 是春假吗`
- `五一期间本科生停课吗`

Required output facts:

- target date or date range
- day kind
- event name when applicable
- stop-class / holiday status when available
- applies-to audience when available
- source refs

### R4: Class Day Pattern And Makeup Class

The tool must answer makeup-class and class-day override questions.

Examples:

- `2026-04-25 执行哪天课表`
- `5 月 9 日要补课吗`
- `五一调休哪天上课`

Required output facts:

- target date
- `is_makeup_class`
- class day pattern
- source refs

### R5: Term Window

The tool must answer term-window questions.

Examples:

- `春季学期什么时候开始`
- `本学期什么时候结束`
- `2025-2026 学年春季学期是哪段时间`

Required output facts:

- academic year
- term label
- start date
- end date / end exclusive
- source refs

## Routing Requirements

The planner must route these to `academic_calendar_lookup`:

- teaching week questions
- named calendar event range questions
- holiday / class suspension questions
- makeup / class-day-pattern questions
- term window questions

The planner must not route these to `academic_calendar_lookup`:

- `找春假通知原文`
- `下载校历`
- `校历在哪里看`
- personal timetable questions
- concrete exam arrangements outside the calendar projection

## Contract Requirements

`AcademicCalendarLookupPayload` must become explicit enough for deterministic
runtime behavior.

Required payload / normalized-query additions:

- `query_kind`
- `event_query`
- `target_date`
- keep `temporal_query` as the request-level temporal intent
- `audience`
- optional `term_label`

The contract must not add a client-controlled free-form `time_anchor` field.
The runtime resolves the trusted execution anchor server-side and returns it as
`queried_time_anchor` in the result. `target_date` is the explicit calendar date
being queried; it is not the trusted clock source.

`AcademicCalendarLookupResult` must represent event/range answers directly.

Required additions:

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

Existing fields may remain as compatibility fields inside the same internal
contract, but new functionality must not overload `effective_from` /
`effective_until` as event range semantics.

The contract generation path must be explicit:

- update `docs/contracts/schemas/supervisor-execution.openapi.yaml` only if
  supervisor execution wire schema changes
- run `uv run --all-packages python -m
  scripts.generate_supervisor_execution_contracts` when the OpenAPI contract
  changes
- keep `packages/contracts` DTOs, Go structured-query request/result structs
  and Python HTTP decoder in sync

## Data Requirements

The `calendar/academic_calendar` projection must support at least these
logical record families:

- term windows
- teaching-week/day facts
- named calendar events
- class-day overrides

The current implementation has two ingestion entry points:

- one-time curated source truth in
  `configs/ingestion/calendar/academic_calendar/curated-academic-calendars/`
- official-web selected-write academic-calendar candidates in
  `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`

The current accepted 2025-2026 calendar source truth lacks an explicit `春假`
event name, and the current official-web extraction regex covers holidays such
as `劳动节` but not `春假`. This is a current source-truth gap, not a permanent
system limitation. This workstream must return source-backed `not_found` for
`今年春假是什么时候` until an explicit source-backed event record or
source-backed extraction path exists.

Important constraint: do not infer `春假` from `春季社会实践周` or generic
course-suspension notices unless the source explicitly names spring break or
the repo admits a documented institution-specific alias rule.

## Evaluation Requirements

The workstream must add or update evals for:

- tool selection
- payload normalization
- structured query resolver
- interval boundary behavior
- answer contract
- source-required fail-close
- public/chat product-path E2E

Resolved calendar answers must fail if `source_refs` are empty.

Public/chat evidence may be implemented in this workstream or handed off to
`public-chat-campus-services-e2e-acceptance`, but the completion claim must
name the artifact that proves the real entry path.

## Success Criteria

- `2026-05-07 是第几教学周` resolves through
  `campus-services-agent + academic_calendar_lookup`
- `今年春假是什么时候` returns source-backed `not_found` until an explicit
  source-backed `春假` event exists
- `找春假通知原文` routes to notice lookup, not calendar lookup
- `校历在哪里看` routes to service guide, not calendar lookup
- public/chat E2E covers at least one date-week case and one named-event case
- deterministic tests cover event interval start/end boundaries
- docs and runtime registry describe the final boundary consistently
