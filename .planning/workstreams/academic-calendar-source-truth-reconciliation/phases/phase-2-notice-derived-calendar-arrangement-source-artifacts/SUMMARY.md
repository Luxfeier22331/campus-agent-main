---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Phase 2 Summary: Notice-derived Calendar Arrangement Source Artifacts

## Completed

Phase 2 admitted selected authenticated-notice-derived calendar facts as
source-truth artifacts.

Added source artifact:

- `configs/ingestion/calendar/academic_calendar/notice-calendar-arrangements/central-minzu-2026-labor-social-practice-course-adjustment.v1.json`

Admitted direct notice evidence:

- `355589`: `关于发布“五一”劳动节假期放假安排的通知`
- `355682`: `关于运动会、春季社会实践周、劳动节假期本（预）科、 研究生课程调整的通知`

Added source-truth records:

- `workday_makeup`: `2026-04-25` executes the `2026-05-05` teaching plan
- `course_suspension`: `2026-04-27` to `2026-05-05` for undergraduate,
  preparatory and graduate courses
- `normal_rest_day`: `2026-05-09` is normal rest

Updated manifest:

- `configs/ingestion/calendar/academic_calendar/source-truth.v1.json`
  - adds `notice_calendar_arrangements`
  - changes expected ready records to `51`

## Boundary

No runtime exception or prompt-time heuristic was added. The notice-derived
facts enter only through source-truth admission and projection build.
