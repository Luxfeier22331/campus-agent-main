---
doc_type: gap_ledger
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Gap Ledger: Academic Calendar Source Truth Reconciliation

## Open Gaps

No open gaps remain inside this workstream boundary.

## Recently Closed Or Downgraded

| Gap | Status | Evidence |
|-----|--------|----------|
| Durable evidence matrix missing before notice source artifact admission | closed | `phases/phase-0-evidence-audit-and-boundary-freeze/SUMMARY.md` records baseline records, notices `355589` / `355682`, supporting notices and boundary freeze |
| Direct vs supporting notice role was ambiguous | closed | Phase 0 classifies `355589` / `355682` as direct calendar truth and `355881` / `355867` as service/transport context |
| Baseline curated calendar conflicts with notice truth on `2026-05-09` | closed | Reconciled projection emits notice-derived `normal_rest_day`; local release preview has no baseline `2026-05-09` class-day override |
| Notice-derived calendar arrangements are not admitted into source truth | closed | `source-truth.v1.json` includes `notice_calendar_arrangements`; default projection record count is `51` |
| Course suspension cannot be represented as first-class calendar fact | closed | Projection and runtime accept `course_suspension`; Go runtime test covers `2026-04-28 上课吗` |
| `春假` colloquial alias lacks source-backed composite semantics | closed | Notice artifact stores `春假` as `colloquial`; runtime and adapter tests cover official wording |
| Release gate does not block silent calendar/notice conflicts | closed | Validation requires precedence/conflict metadata; Phase 3 preview validation is `valid=true` with explained conflicts |
| Docs still describe current accepted source as single curated calendar | closed | Calendar README now describes baseline plus notice-derived arrangement source truth |

## Completion Audit

Completed during Phase 6 closeout and follow-up review:

| Success Criterion | Status | Evidence |
|-------------------|--------|----------|
| `2026-05-09 上课吗` returns `正常公休` | complete | Go runtime test `TestLookupAcademicCalendarDayStatusPrefersNoticeNormalRestDay` |
| `今年春假是什么时候` returns official composite arrangement | complete | Go runtime test `TestLookupAcademicCalendarResolvesSpringBreakAliasWhenSourceBacked`; adapter test explains colloquial wording |
| `2026-04-28 上课吗` returns course suspension | complete | Go runtime test `TestLookupAcademicCalendarDayStatusPrefersNoticeCourseSuspension` |
| Projection validation catches conflicting day status | complete | Validation tests reject unexplained conflicts; release preview has explained notice precedence |
| Runtime remains projection-backed only | complete | Implementation only changes projection builder/read-model resolver; no raw notice scan path added |
| Docs and registry agree on boundary | complete | Calendar README and workstream summaries updated |
| `春季社会实践周是什么时候` resolves from source-backed alias | complete | Go runtime test `TestLookupAcademicCalendarResolvesSocialPracticeWeekAliasWhenSourceBacked` |
| `找春假通知原文` stays in notice/card denominator | complete | Planner test `TestPlanNoticeOriginalSpringBreakStaysNoticeLookup`; product-path and public-entry fixtures include `public-chat-notice-spring-break-original` / `public-entry-notice-spring-break-original` |
| PG `--promote-current` publish and current-release smoke pass | complete | `var/academic-calendar-release-pg-smoke/report.json` published `academic-calendar-muc-2025-2026-20260507T000000` with `current=true`, `record_count=51`; `var/academic-calendar-runtime-pg-smoke-v3/academic-calendar-selected-write-runtime-smoke.json` passed against current PG release |
