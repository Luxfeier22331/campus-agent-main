---
doc_type: phase_summary
status: completed
created: 2026-05-07
updated: 2026-05-07
---

# Phase 5 Summary: Planner, Adapter And Eval Denominator

## Completed

Phase 5 kept routing semantics explicit and expanded answer/eval coverage.

Planner behavior:

- calendar fact queries such as `今年春假是什么时候` continue to route to
  `academic_calendar_lookup`
- notice-original queries such as `找一下2026年春假通知` continue to route to
  `notice-agent`
- notice-original/card queries such as `找春假通知原文` remain in the
  notice/card denominator instead of academic-calendar fact lookup

Adapter behavior:

- `campus-services-agent` answer wording now explains that `春假` is colloquial
  wording
- answer text returns the official source-backed composite arrangement and the
  applicable course-suspension audience

Eval denominator updates:

- `packages/evals/fixtures/public_chat_product_path_cases.v1.json`
  - `public-chat-academic-calendar-spring-break-colloquial`
  - `public-chat-academic-calendar-course-suspension`
  - `public-chat-academic-calendar-notice-rest-day-override`
  - `public-chat-notice-spring-break-original`
- `packages/evals/fixtures/public_chat_entry_cases.v1.json`
  - `public-entry-academic-calendar-spring-break-colloquial`
  - `public-entry-academic-calendar-notice-rest-day-override`
  - `public-entry-notice-spring-break-original`

Verification:

```bash
cd apps/supervisor-api
go test -count=1 ./internal/structuredplanning

uv run --all-packages python -m unittest \
  tests.agent.campus_services_academic_calendar_suite \
  tests.evals.public_chat_product_path_eval_suite \
  tests.evals.public_chat_entry_e2e_suite -q
```
