---
workstream: academic-calendar-lookup-capability-closeout
created: 2026-05-07
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Completed
**Last Activity:** 2026-05-07
**Last Activity Description:** Workstream implemented; contract, projection,
resolver, planner, adapter, eval denominator, docs and validation checks
completed

## Progress

**Phases Complete:** 9
**Current Plan:** Complete; reopen only on boundary drift or source-truth
regression
**Latest Review:** `PLANNING-REVIEW.md`
**Latest Phase Evidence:** focused Go/Python/eval/docs verification for
Phase 1-8 implementation

## Session Continuity

**Stopped At:** Workstream complete
**Resume File:** None

## Current Internal Design Summary

- Runtime owner is `campus-services-agent`.
- Tool is `academic_calendar_lookup`.
- Data-plane owner remains `calendar/academic_calendar`.
- Python agent layer is a thin adapter.
- Go structured query runtime owns deterministic lookup.
- Current source truth has a one-time curated official-web projection path and
  an official-web selected-write candidate path.
- Current accepted truth also includes notice-derived calendar arrangements
  admitted by `academic-calendar-source-truth-reconciliation`.
- `春假` resolves only as a source-backed colloquial alias to the official
  `运动会、春季社会实践周、劳动节假期课程调整` wording; it is not stored as an
  official event name.
- `2026-05-09` current projection is notice-derived `normal_rest_day`, not the
  baseline `执行周一课表`.

## Completed Capabilities

- Payload/result contract expresses `query_kind`, event query, target date,
  event ranges, display dates, source title/url and calendar record id.
- Projection records distinguish `teaching_week`, `named_event`,
  `term_window` and `class_day_override`.
- Internal event interval semantics are start-inclusive / end-exclusive.
- Resolver handles date-week, named-event range, day-status,
  class-day-pattern and term-window queries deterministically.
- Resolver returns source-backed spring-break answers via colloquial alias
  mapping and keeps notice-original requests out of the tool.
- Planner emits normalized calendar payload fields and keeps notice original /
  service-guide entry questions out of `academic_calendar_lookup`.
- Provider function schema and bridge payload decoder preserve new fields.
- Public-chat eval fixtures include academic calendar date-week and named-event
  cases.

## Reopen Rule

Reopen only if `academic_calendar_lookup` stops returning source-backed
calendar facts, if `春假` no longer resolves only through the admitted
colloquial alias path, if `2026-05-09` current projection loses the
notice-derived `normal_rest_day` correction, if runtime begins querying raw
official-web/RAG at query time, or if planner routing again confuses calendar
facts with notice original or service-guide entry questions.
