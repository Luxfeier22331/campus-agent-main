# academic_calendar reference data

`academic_calendar` is a curated structured data asset. It is not exposed as a
campus-services runtime tool.

This directory is reference data, not an ingestion-control collection. It does
not declare a task registry, runtime profile, retrieval alias, or model-visible
structured tool.

## Source Truth

- `source-truth.v1.json` declares reconciled academic-calendar source truth for
  `calendar/academic_calendar`.
- `curated-academic-calendars/synthetic-2026.v1.json` contains the public repo
  baseline fixture for curated calendar facts.
- `notice-calendar-arrangements/synthetic-course-adjustment.v1.json` contains
  the public repo fixture for notice-derived calendar arrangement facts.
- Official-web page/image source refs remain evidence only. Image-only collector
  candidates must not be promoted directly to current facts without this
  structured curated artifact.
- Authenticated notice artifacts may override or supplement baseline calendar
  facts only through source-truth admission. Runtime lookup never scans raw
  notice exports, raw HTML, OCR assets or generic RAG for calendar facts.

## Publish

This reference-data scope has no active ingestion-control task registry. The
previous `structured_projection_publish` and `operator_projection_snapshot`
task declarations were removed because they had no real default TS handlers.

There is no active Python publish CLI for this collection. If calendar
publication needs to re-enter ingestion-control, add a real TS handler and the
matching registry task in the same change; do not restore placeholder tasks or
infer a partial projection from raw HTML, OCR assets or generic RAG.

## Public Repo Boundary

Tracked files in this directory are synthetic source-truth fixtures. Real
academic-calendar releases, source images, OCR evidence and service-question
smoke reports live in the private data/artifact boundary and are not published
under the repository license.
