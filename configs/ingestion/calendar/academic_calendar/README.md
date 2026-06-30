# academic_calendar collection config

`academic_calendar` is a curated structured data asset. It is not exposed as a
campus-services runtime tool.

This profile stays in `offline_preparation`: it does not open generic retrieval,
a default query-serving alias, or a model-visible structured tool. The current
read model remains available for later standalone calendar design.

## Source Truth

- `source-truth.v1.json` declares reconciled academic-calendar source truth for
  `calendar/academic_calendar`.
- `curated-academic-calendars/central-minzu-2025-2026.v1.json` contains the
  manually/OCR-reviewed structured facts extracted from the official public
  calendar page and image evidence. It remains the baseline source family.
- `notice-calendar-arrangements/central-minzu-2026-labor-social-practice-course-adjustment.v1.json`
  contains authenticated-notice-derived calendar arrangement facts admitted from
  notices `355589` and `355682`.
- Official-web page/image source refs remain evidence only. Image-only collector
  candidates must not be promoted directly to current facts without this
  structured curated artifact.
- Authenticated notice artifacts may override or supplement baseline calendar
  facts only through source-truth admission. Runtime lookup never scans raw
  notice exports, raw HTML, OCR assets or generic RAG for calendar facts.

## Publish

This collection currently has no active ingestion-control task registry. The
previous `structured_projection_publish` and `operator_projection_snapshot`
task declarations were removed because they had no real default TS handlers.

There is no active Python publish CLI for this collection. If calendar
publication needs to re-enter ingestion-control, add a real TS handler and the
matching registry task in the same change; do not restore placeholder tasks or
infer a partial projection from raw HTML, OCR assets or generic RAG.

## Current Release Evidence

- release id: `academic-calendar-muc-2025-2026-20260507T000000`
- current projection: `calendar/releases/academic_calendar/current/academic-calendar-projection.json`
- current read model: `calendar/academic_calendar`
- record count: 51
- validation: `valid=true`
- runtime smoke evidence:
  `var/ingestion-evidence/official-web-source-pack-collection-execution/academic-calendar-structured-release/runtime-smoke-report.json`

Validated service questions:

- `今天第几教学周`
- `五一放几天`
- `劳动节放假怎么安排`
- `2026-05-01 上课吗`
- `本学期什么时候结束`
- `哪周补课`
- `今年春假是什么时候`
- `2026-04-28 上课吗`
- `2026-05-09 上课吗`
- `4月25日为什么要上课`

The reconciled source truth produces 51 current-ready records:

- 39 baseline teaching-week records
- 7 named events
- 2 term windows
- 1 notice-derived `workday_makeup`
- 1 notice-derived `course_suspension`
- 1 notice-derived `normal_rest_day`

`春假` is stored only as a colloquial alias for the official
`运动会、春季社会实践周、劳动节假期课程调整` course-suspension arrangement. It is not
stored as an official event name.

This release is a curated structured projection plus selected authenticated
notice-derived arrangement artifact. It does not reopen a recurring official-web
collector lane or query-time notice scan.
