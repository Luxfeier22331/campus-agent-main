---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Phase 6 Summary: Release, Smoke And Documentation Closeout

## Completed

Phase 6 produced local release-preview evidence, PG `--promote-current`
publish evidence, runtime smoke against the promoted Postgres release, and
updated planning / collection documentation.

Updated docs:

- `configs/ingestion/calendar/academic_calendar/README.md`
- `.planning/workstreams/academic-calendar-source-truth-reconciliation/STATE.md`
- `.planning/workstreams/academic-calendar-source-truth-reconciliation/GAP-LEDGER.md`
- `.planning/workstreams/academic-calendar-source-truth-reconciliation/ROADMAP.md`

Local smoke:

```bash
uv run --all-packages python scripts/publish_academic_calendar_projection.py \
  --output-dir var/academic-calendar-release \
  --generated-at 2026-05-07T00:00:00+08:00 \
  --report-path var/academic-calendar-release/report.json
```

Observed smoke evidence:

- `record_count=51`
- validation artifact has `valid=true`
- `course_suspension`, `workday_makeup` and `normal_rest_day` records are present
- `2026-05-09` resolves in the current artifact as notice-derived
  `normal_rest_day`

PG publish smoke:

```bash
uv run --all-packages python scripts/publish_academic_calendar_projection.py \
  --output-dir var/academic-calendar-release-pg-smoke \
  --generated-at 2026-05-07T00:00:00+08:00 \
  --report-path var/academic-calendar-release-pg-smoke/report.json \
  --promote-current
```

Observed PG publish evidence:

- `published=true`
- `promote_current=true`
- `release_id=academic-calendar-muc-2025-2026-20260507T000000`
- `record_count=51`
- PG current pointer moved to the same release

Runtime smoke against current PG release:

```bash
uv run --all-packages python scripts/academic_calendar_selected_write_runtime_smoke.py \
  --output-dir var/academic-calendar-runtime-pg-smoke-v3
```

Observed runtime evidence:

- smoke `passed=true`
- current PG release read as `academic-calendar-muc-2025-2026-20260507T000000`
- `今天第几教学周` resolves to week `10`
- `五一放几天` resolves to the notice-backed official composite arrangement
- `今年春假是什么时候` resolves through the source-backed colloquial alias path
- `2026-05-09 上课吗` resolves to notice-derived `normal_rest_day`
