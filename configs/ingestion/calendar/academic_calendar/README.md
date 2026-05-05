# academic_calendar collection config

`academic_calendar` is an offline structured projection consumed through
`academic_calendar_lookup`.

This profile does not open retrieval or a default query-serving alias. It only
declares that the projection-backed structured query runtime may consume the
current academic calendar read model for teaching week, holiday, and makeup
class facts.

## Source Truth

- `source-truth.v1.json` declares one-time curated academic-calendar source
  truth for `calendar/academic_calendar`.
- `curated-academic-calendars/central-minzu-2025-2026.v1.json` contains the
  manually/OCR-reviewed structured facts extracted from the official public
  calendar page and image evidence.
- Official-web page/image source refs remain evidence only. Image-only collector
  candidates must not be promoted directly to current facts without this
  structured curated artifact.

## Publish

Preview/write release artifacts:

```bash
uv run --all-packages python scripts/publish_academic_calendar_projection.py \
  --output-dir var/academic-calendar-release \
  --generated-at 2026-05-05T10:00:00+08:00
```

Publish to the structured Postgres read model by additionally passing
`--database-url "$CAMPUS_SHARED_POSTGRES_URL" --promote-current`.

## Current Release Evidence

- release id: `academic-calendar-muc-2025-2026-20260505T100000`
- current projection: `calendar/releases/academic_calendar/current/academic-calendar-projection.json`
- current read model: `calendar/academic_calendar`
- record count: 47
- validation: `valid=true`
- runtime smoke evidence:
  `.planning/workstreams/official-web-source-pack-collection-execution/evidence/academic-calendar-structured-release/runtime-smoke-report.json`

Validated service questions:

- `今天第几教学周`
- `五一放几天`
- `哪周补课`

This release is a one-time curated structured projection. It does not reopen a
recurring official-web collector lane.
