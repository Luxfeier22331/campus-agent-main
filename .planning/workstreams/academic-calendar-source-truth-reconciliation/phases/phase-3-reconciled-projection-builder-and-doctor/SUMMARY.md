---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Phase 3 Summary: Reconciled Projection Builder And Doctor

## Completed

Phase 3 extended the academic-calendar projection builder to merge baseline
calendar source truth and notice-derived calendar arrangement artifacts.

Implemented behavior:

- `source-truth.v1.json` loads `notice_calendar_arrangements`
- builder validates notice-derived records as
  `authenticated_notice_calendar_arrangement_v1`
- merge path keeps source families, source documents and source refs
- `normal_rest_day` with higher source precedence overrides the conflicting
  baseline `2026-05-09` `makeup_class_day`
- validation preserves conflict checks for unexplained
  `course_suspension` / `teaching_week` and
  `normal_rest_day` / `class_day_override` overlaps

Release preview evidence:

```bash
uv run --all-packages python scripts/publish_academic_calendar_projection.py \
  --output-dir var/academic-calendar-release \
  --generated-at 2026-05-07T00:00:00+08:00 \
  --report-path var/academic-calendar-release/report.json
```

Observed artifact facts:

- release id: `academic-calendar-muc-2025-2026-20260507T000000`
- current projection record count: `51`
- validation: `valid=true`, `issues=[]`
- record families include:
  - `course_suspension`: `1`
  - `workday_makeup`: `1`
  - `normal_rest_day`: `1`
- `2026-05-09` current day-status fact is notice-derived `normal_rest_day`

## Deferred

Real PG promotion was not run in this phase summary. Phase 6 treats local
artifact release preview as completed smoke and keeps PG promotion as
environment-dependent deployment operation.
