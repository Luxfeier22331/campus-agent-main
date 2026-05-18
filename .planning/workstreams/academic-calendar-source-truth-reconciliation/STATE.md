---
workstream: academic-calendar-source-truth-reconciliation
created: 2026-05-07
---

# Project State

## Current Position
**Status:** Completed
**Current Phase:** Phase 6 - Release, Smoke And Documentation Closeout
**Last Activity:** 2026-05-07
**Last Activity Description:** Completed PG `--promote-current` publish smoke,
runtime smoke against current Postgres release, and closeout documentation sync

## Progress
**Phases Complete:** 7
**Current Plan:** Workstream implementation complete and promotion smoke closed.

## Session Continuity
**Stopped At:** Workstream complete after Phase 6 local smoke
**Resume File:** `ROADMAP.md`

## Phase 0 Result

Evidence audit is now durable in
`phases/phase-0-evidence-audit-and-boundary-freeze/SUMMARY.md`.

Key conclusions:

- `春假` is colloquial wording, not official source truth naming.
- Official wording is the combined `运动会、春季社会实践周、劳动节假期`
  arrangement.
- Direct calendar-truth notices for the next source artifact phase are
  `355589` and `355682`.
- Social-practice shuttle and transport schedule notices are supporting
  context, not calendar source truth for this workstream.
- `2026-05-09` is an explicit conflict: baseline says `执行周一课表`, while
  both direct notices say `正常公休`.

## Phase 1 Result

Projection contract now admits `course_suspension`, `normal_rest_day` and
`workday_makeup` record families. Calendar records now carry source family,
source precedence, notice ids, precedence reason, conflict refs and alias type
metadata. Validation blocks unexplained conflicting calendar facts and requires
`春假` to be explicitly typed as a colloquial alias.

Focused verification passed:

- `uv run --all-packages python -m unittest tests.ingestion.test_academic_calendar_projection tests.test_publish_academic_calendar_projection -q`
- `cd apps/supervisor-api && go test -count=1 ./internal/structuredquery`

## Current Problem

Resolved in this workstream. `calendar/academic_calendar` source truth now
combines the curated official-web baseline with selected authenticated notice
calendar-arrangement facts.

Concrete evidence:

- `355589` says `2026-05-09` is normal rest and is admitted as source truth.
- `355682` says `2026-05-09` is normal rest and `2026-04-27` to
  `2026-05-05` courses are suspended for the combined official arrangement.
- The reconciled current projection removes the conflicting baseline
  `2026-05-09` class-day override and emits notice-derived `normal_rest_day`.

## Closeout Evidence

- Local release preview:
  `uv run --all-packages python scripts/publish_academic_calendar_projection.py --output-dir var/academic-calendar-release --generated-at 2026-05-07T00:00:00+08:00 --report-path var/academic-calendar-release/report.json`
- PG promote smoke:
  `uv run --all-packages python scripts/publish_academic_calendar_projection.py --output-dir var/academic-calendar-release-pg-smoke --generated-at 2026-05-07T00:00:00+08:00 --report-path var/academic-calendar-release-pg-smoke/report.json --promote-current`
- Runtime smoke against current PG release:
  `uv run --all-packages python scripts/academic_calendar_selected_write_runtime_smoke.py --output-dir var/academic-calendar-runtime-pg-smoke-v3`
- Release preview record count: `51`
- Validation artifact: `valid=true`, `issues=[]`
- PG current release:
  `academic-calendar-muc-2025-2026-20260507T000000`
- Current projection contains:
  - `course_suspension`: `1`
  - `workday_makeup`: `1`
  - `normal_rest_day`: `1`
- Focused tests passed:
  - `uv run --all-packages python -m unittest tests.ingestion.test_academic_calendar_projection tests.test_publish_academic_calendar_projection -q`
  - `uv run --all-packages python -m unittest tests.test_academic_calendar_selected_write_runtime_smoke -q`
  - `cd apps/supervisor-api && go test -count=1 ./internal/structuredquery`
  - `cd apps/supervisor-api && go test -count=1 ./internal/structuredplanning`
  - `uv run --all-packages python -m unittest tests.agent.campus_services_academic_calendar_suite -q`

## Current Scope Decision

`春假` is not an official event name. The system should support it as a
colloquial alias only when mapped to source-backed official wording:
`运动会、春季社会实践周、劳动节假期` course adjustment.

Runtime lookup must continue to read projection/read-model truth only; no raw
notice scan or generic RAG fallback is allowed at query time.
