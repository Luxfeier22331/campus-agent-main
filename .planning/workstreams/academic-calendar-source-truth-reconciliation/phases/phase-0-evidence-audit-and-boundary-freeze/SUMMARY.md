---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Phase 0 Summary: Evidence Audit And Boundary Freeze

## Goal

Phase 0 audited the source evidence for the 2026 late-April / early-May
academic calendar discrepancy and froze the implementation boundary for the
remaining phases.

The audit confirms that the user-facing phrase `春假` is a colloquial student
wording. The official source wording for the target period is the combined
arrangement around `运动会、春季社会实践周、劳动节假期`.

## Source Evidence

Baseline public calendar:

- source file:
  `configs/ingestion/calendar/academic_calendar/curated-academic-calendars/central-minzu-2025-2026.v1.json`
- public source page:
  `https://www.muc.edu.cn/ggfw/mdxl.htm`
- public calendar image:
  `https://www.muc.edu.cn/__local/5/EE/5C/910912FEE16E4D01AB20F32EBD8_4236E2EF_3EE8C.jpg`

Direct authenticated notice evidence:

- notice `355589`
  - title: `关于发布“五一”劳动节假期放假安排的通知`
  - source file:
    `apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260425T122117.555Z.json`
  - release time: `2026-04-15 08:50`
  - browser URL:
    `https://my.muc.edu.cn/#/print?type=5&notice_id=355589&show_type=1`
- notice `355682`
  - title: `关于运动会、春季社会实践周、劳动节假期本（预）科、 研究生课程调整的通知`
  - source file:
    `apps/authenticated-notice-collector/runtime/exports/notices-bundle-20260427T020248.597Z.json`
  - release time: `2026-04-16 17:27`
  - browser URL:
    `https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1`

Supporting context notices found during search:

- notice `355881`: `关于开通丰台校区社会实践专车的通知`
- notice `355867`: `关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`

These two supporting notices confirm related service and transport operations
during the period, but they do not directly define academic calendar truth for
this workstream.

## Extracted Facts

Baseline calendar records covering `2026-04-25` to `2026-05-09`:

- `2026-04-20` to `2026-04-26`: `teaching_day`
- `2026-04-27` to `2026-05-03`: `teaching_day`
- `2026-05-04` to `2026-05-10`: `teaching_day`
- `2026-05-01` to `2026-05-05`: `劳动节假期`
- `2026-05-09`: `makeup_class_day`, `执行周一课表`

Notice `355589` facts:

- `2026-05-01` to `2026-05-05`: `劳动节假期` 放假
- `2026-04-25`: 上班上课，执行 `2026-05-05` 教学计划
- `2026-05-09`: 正常公休

Notice `355682` facts:

- official basis names three school arrangements:
  - `关于举行中央民族大学第59届田径运动会的通知`
  - `关于发布“五一”劳动节假期放假安排的通知`
  - `关于组织开展2026年春季社会实践周活动的通知`
- `2026-04-27` to `2026-05-05`: 全校本（预）科生、研究生课程停课
- `2026-04-25`: 按照 `2026-05-05` 教学安排正常上课
- `2026-05-09`: 正常公休

## Evidence Matrix

### `2026-04-25`

- baseline fact: teaching day in the `2026-04-20` to `2026-04-26` week
- notice fact: workday / class day executing the `2026-05-05` teaching plan
- relationship: supplement to baseline
- proposed projection fact: `workday_makeup`
- direct source notices: `355589`, `355682`
- precedence: notice-derived fact carries the specific class-day pattern

### `2026-04-27` To `2026-04-30`

- baseline fact: teaching day in the `2026-04-27` to `2026-05-03` week
- notice fact: course suspension for undergraduate/preparatory and graduate
  courses
- relationship: notice-derived supplement / override for course status
- proposed projection fact: `course_suspension`
- direct source notice: `355682`
- precedence: notice-derived course arrangement is more specific than baseline
  teaching-week status

### `2026-05-01` To `2026-05-03`

- baseline fact: `劳动节假期`
- notice fact: `劳动节假期` and course suspension during the combined period
- relationship: confirmation plus supplementary course-status fact
- proposed projection facts: `named_event` for `劳动节假期` and
  `course_suspension`
- direct source notices: `355589`, `355682`
- precedence: baseline and notice agree on holiday; notice supplies course
  suspension audience semantics

### `2026-05-04` To `2026-05-05`

- baseline fact: teaching day in the `2026-05-04` to `2026-05-10` week, plus
  overlapping `劳动节假期`
- notice fact: `劳动节假期` and course suspension during the combined period
- relationship: notice-derived and holiday facts override generic teaching day
  for day-status answers
- proposed projection facts: `named_event` for `劳动节假期` and
  `course_suspension`
- direct source notices: `355589`, `355682`
- precedence: holiday and later notice arrangement are more specific than the
  generic teaching-week record

### `2026-05-09`

- baseline fact: `makeup_class_day`, `执行周一课表`
- notice fact: `正常公休`
- relationship: explicit conflict
- proposed projection fact: `normal_rest_day`
- direct source notices: `355589`, `355682`
- precedence: later official notices override the baseline calendar for this
  concrete date/day-status arrangement
- release implication: future projection release must not silently keep both
  facts without `conflict_refs` and `precedence_reason`

### Colloquial `春假`

- official source wording: `运动会、春季社会实践周、劳动节假期`
- user wording: `春假`
- relationship: colloquial alias, not official event name
- proposed projection shape: source-backed alias to the composite arrangement
- direct source notice: `355682`
- answer requirement: return official wording and state that `春假` is the
  colloquial label

## Supporting Notice Decision

The separate `春季社会实践周` supporting hits are not admitted as direct calendar
truth in Phase 0:

- `355881` is a social-practice shuttle/service notice.
- `355867` is a transport schedule notice.

Both can remain discoverable through notice or transport surfaces, but they
must not define academic-calendar day status unless a later phase explicitly
admits a calendar-arrangement source artifact for that purpose.

## Boundary Freeze

Frozen decisions for the rest of the workstream:

- `春假` is not an official event name.
- `春假` may only resolve as a `colloquial` alias backed by admitted source
  evidence.
- `academic_calendar_lookup` must read reconciled projection/read-model truth.
- Runtime must not scan raw notice exports, raw HTML, OCR assets or generic RAG
  for calendar facts.
- Notice-original requests such as `找春假通知原文` remain notice lookup/card
  responsibility.
- Source-truth reconciliation belongs in the ingestion/data-plane projection,
  not in prompt wording or agent heuristics.
- A service/transport notice can support context, but it is not calendar truth
  unless admitted as a calendar source artifact.

## Phase Impact

Phase 1 had already implemented the schema and validation contract using
carried-forward evidence. This Phase 0 summary makes that evidence durable
inside the workstream and unblocks Phase 2 source artifact admission.

Phase 0 does not resolve the projection conflict. The `2026-05-09` correction
remains Phase 3 work after Phase 2 admits notice-derived source artifacts.

## Acceptance Mapping

- source paths and notice ids are recorded above
- the `2026-05-09` baseline-vs-notice conflict is explicit
- official wording for student `春假` is documented as the composite
  arrangement
- supporting social-practice and transport notices are classified as context
- runtime and data-plane boundaries are frozen before implementation
