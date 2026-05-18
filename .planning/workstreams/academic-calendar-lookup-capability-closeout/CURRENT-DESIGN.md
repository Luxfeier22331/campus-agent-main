---
doc_type: design-audit
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Current Design: Academic Calendar Lookup

## Runtime Ownership

`academic_calendar_lookup` is now a `campus-services-agent` structured tool.
The standalone `calendar-agent` runtime owner has been retired by
`academic-calendar-campus-services-consolidation`.

Current owner facts:

- agent: `campus-services-agent`
- capability: `campus_services`
- tool: `academic_calendar_lookup`
- data-plane target: `calendar/academic_calendar`
- HTTP route: `/internal/query/calendar/academic-calendar`

Key files:

- `configs/runtime/agents.v1.json`
- `configs/runtime/tools.v1.json`
- `packages/campus-services-agent/src/campus_services_agent/tool_adapter.py`
- `apps/supervisor-api/internal/httpapi/structured_query_handlers.go`
- `apps/supervisor-api/internal/structuredquery/academic_calendar.go`

## Current Contract

Current payload:

- `query_text`
- `temporal_query`
- `academic_year_label`
- `date_hint`
- `query_kind`
- `event_query`
- `target_date`
- `audience`
- `term_label`

Current result:

- `query_kind`
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
- `conflict_refs`

This contract handles direct teaching-week lookup, named event ranges,
day-status, term-window and makeup lookup. Current accepted truth also
includes the later `academic-calendar-source-truth-reconciliation` follow-up:
`今年春假是什么时候` resolves through a source-backed colloquial alias to the
official composite arrangement instead of requiring an official `春假` event
record.

## Current Data Plane

The current projection has a curated path, a selected-write path and admitted
notice-derived calendar-arrangement source truth:

- a one-time curated source truth from official-web calendar page/image
  evidence
- official-web selected-write academic-calendar candidates that can publish
  into `calendar/academic_calendar`
- notice-derived calendar-arrangement artifacts admitted through
  `configs/ingestion/calendar/academic_calendar/notice-calendar-arrangements/`

Key files:

- `configs/ingestion/calendar/academic_calendar/source-truth.v1.json`
- `configs/ingestion/calendar/academic_calendar/curated-academic-calendars/central-minzu-2025-2026.v1.json`
- `packages/ingestion-core/src/campus_ingestion_core/academic_calendar_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_academic_calendar_projection.py`
- `apps/ingestion-worker/src/campus_ingestion_worker/release_official_web_selected_write.py`
- `scripts/publish_academic_calendar_projection.py`

Current curated source truth:

- schema: `official_web_curated_academic_calendar.v1`
- projection: `academic_calendar_projection.v1`
- expected records: `49`
- current examples: teaching-week records, `清明节假期`, `劳动节假期`,
  `寒假`, `暑假`, makeup class day

Important current truth:

- The curated source has `2026-04-27` to `2026-05-03` as a teaching-week
  record and `2026-05-01` to `2026-05-05` as `劳动节假期`.
- The reconciled projection admits notice-derived official wording
  `运动会、春季社会实践周、劳动节假期课程调整` and types `春假` only as a
  `colloquial` alias.
- The reconciled projection also replaces the baseline `2026-05-09`
  `执行周一课表` fact with notice-derived `normal_rest_day`.
- Therefore `今年春假是什么时候` now resolves to the source-backed official
  composite arrangement, while preserving that `春假` is not an official event
  name.

## Current Go Resolver

`apps/supervisor-api/internal/structuredquery/academic_calendar.go` currently:

- loads the current `calendar/academic_calendar` bundle
- defaults date lookup to `target_date`, `date_hint`, ISO dates in the query
  text, or current trusted time
- resolves `date_week`, `named_event_range`, `day_status`,
  `class_day_pattern` and `term_window`
- matches records by academic year, term label, query kind, event alias and
  interval containment
- ranks records by event/makeup/week score

Current resolver strengths:

- deterministic read-model query
- fail-closed when source truth or bundle is unavailable
- supports current/date-hinted teaching week
- supports named event range lookup for source-backed events
- supports day-status lookup for holiday and teaching-day facts
- supports term-window lookup
- supports next makeup class lookup

Current resolver gaps:

- audience-specific filtering is not yet implemented beyond preserving
  `applies_to`
- conflict projection for academic calendar records is not a separate table yet
- natural-language relative date arithmetic such as `下周一` still requires
  planner/caller normalization into `target_date` / `date_hint`

The resolver uses start-inclusive / end-exclusive semantics when
`event_end_date_exclusive` is present, while preserving a user-facing inclusive
`display_end_date`.

## Current Python Adapter

`packages/campus-services-agent` is intentionally thin:

- `tool_adapter.py` dispatches payloads to `lookup_academic_calendar`
- `http_query_service.py` posts to the supervisor structured-query route
- `academic_calendar_adapter.py` renders answer text and observability

The Python adapter should remain thin. This workstream should put deterministic
calendar resolution in the Go structured query runtime and typed read model,
not in prompt text or Python string heuristics.

## Current Routing

`configs/runtime/intent-policy.v1.json` already contains calendar cues:

- `academic_calendar_week_query`
- `academic_calendar_holiday_query`
- `academic_calendar_makeup_query`
- `academic_calendar_semantic_subject`

Current routing boundary:

- Calendar fact queries, notice-document queries and service-guide queries stay
  explicitly separated.
- `春假通知原文` must remain notice lookup.
- `校历在哪里看` must remain service guide.
- `今年春假是什么时候` routes to calendar lookup and resolves only through the
  admitted source-backed colloquial alias path.

## Current Eval Coverage

Existing coverage includes:

- Go structured-query tests for teaching week, named event range, day status,
  term-window, missing source refs, unsupported query kind and makeup class
- Python campus-services adapter tests for `academic_calendar_lookup`
- provider function schema and bridge dispatch tests
- public/chat product-path and entry E2E denominator fixtures
- runtime process smoke profile `academic_calendar_sdk_opened`

Remaining coverage gaps:

- real browser/staging public/chat entry evidence belongs to
  `public-chat-campus-services-e2e-acceptance`

## Design Constraint

Runtime must only read the configured projection / typed read model. It must
not query raw official-web pages, calendar images, notice HTML, object-store
source bundles, or generic RAG at query time.
