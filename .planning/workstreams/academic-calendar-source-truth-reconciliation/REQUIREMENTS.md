---
doc_type: requirements
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Requirements: Academic Calendar Source Truth Reconciliation

## Goal

Make `calendar/academic_calendar` a reconciled source-backed calendar fact
projection, not a single-source static calendar dump.

The projection must combine the public official calendar baseline with later
official notices that override or supplement teaching arrangements. Runtime
lookup must consume the reconciled projection only.

## Problem Statement

The previous `academic-calendar-lookup-capability-closeout` correctly required
source-backed answers and treated `春假` as not-found because the curated
calendar had no explicit `春假` event. New evidence shows that the user-facing
question is still legitimate, but the official wording is different:

- official wording: `运动会、春季社会实践周、劳动节假期`
- student wording: `春假`
- official effect: `2026-04-27` to `2026-05-05` course suspension
- official holiday: `2026-05-01` to `2026-05-05` Labor Day holiday
- official makeup/workday: `2026-04-25`
- official rest day: `2026-05-09`

The current curated calendar source truth conflicts with notices on
`2026-05-09`. That is a source-truth reconciliation failure, not just a one-line
data typo.

## Functional Requirements

### R1: Multi-source Calendar Fact Projection

The projection must support multiple source families:

- public official calendar baseline
- authenticated notice calendar-arrangement facts

Each output record must preserve source refs and source family provenance.

### R2: Source Precedence And Conflict Semantics

The system must define deterministic precedence:

- later official notices may override baseline calendar facts for concrete
  date/day-status arrangements
- baseline calendar remains valid where no overriding notice exists
- conflicts must be reported in validation/doctor output
- current release must not silently choose a conflicting record without a
  documented precedence reason

### R3: Rich Day Status Families

The projection must represent at least:

- `teaching_week`
- `named_event`
- `term_window`
- `class_day_override`
- `course_suspension`
- `normal_rest_day`
- `workday_makeup`

Existing consumers may keep compatibility fields, but new logic must not force
course suspension or rest-day overrides into `holidayName` or generic
`teaching_day`.

### R4: Colloquial Alias Handling

`春假` must be treated as a colloquial alias only when backed by an admitted
institution-specific rule and source evidence.

Required behavior:

- return official label in the answer
- explain that the official wording is not `春假`
- expose the course-suspension range separately from the Labor Day holiday
  range
- keep notice-original requests routed to notice lookup

### R5: Runtime Resolver Correctness

`academic_calendar_lookup` must resolve:

- date-to-week from baseline calendar
- date status from reconciled day-status records
- named event ranges from source-backed events
- colloquial alias queries from admitted alias records
- class-day override / makeup / normal-rest facts from reconciled projection

Runtime must not query raw notice exports, raw HTML, OCR assets or generic RAG.

### R6: Release Gate And Doctor

Projection release must fail or emit blocking validation when:

- resolved records have no source refs
- overlapping records conflict without precedence
- `normal_rest_day` and `makeup_class_day` both apply to the same date without
  an override explanation
- colloquial aliases point to no source-backed composite event
- expected notice-derived records are absent from selected source truth

## Data Requirements

Initial admitted notice facts:

- `355589`: `关于发布“五一”劳动节假期放假安排的通知`
- `355682`: `关于运动会、春季社会实践周、劳动节假期本（预）科、 研究生课程调整的通知`
- optional supporting service/schedule notice evidence may be retained for
  context but must not define calendar truth unless admitted as calendar
  arrangement source.

The first implementation may use curated notice-arrangement artifacts derived
from already captured notices. It must still model them as source-backed
notice-derived calendar facts, not hand-coded runtime exceptions.

## Evaluation Requirements

Add deterministic tests for:

- `今年春假是什么时候`
- `2026-04-28 上课吗`
- `2026-05-01 放假吗`
- `2026-05-09 上课吗`
- `4月25日为什么要上课`
- `春季社会实践周是什么时候`
- `找春假通知原文`

Assertions must cover:

- selected tool / agent
- payload shape
- structured query result fields
- source refs
- official wording vs colloquial wording
- conflict detection

## Success Criteria

- `2026-05-09 上课吗` resolves as source-backed `正常公休`, not `执行周一课表`
- `今年春假是什么时候` resolves to the official composite course-suspension
  arrangement and states that `春假` is colloquial wording
- `2026-05-01 放假吗` resolves as `劳动节假期`
- `2026-04-28 上课吗` resolves as course suspension for the applicable audience
- current projection validation catches the prior `5月9日` conflict
- docs clearly distinguish baseline calendar, notice overrides and colloquial aliases
