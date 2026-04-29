---
doc_type: phase_summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 3 Summary: Quality Read Model And Metrics

## Outcome

Phase 3 completed the first operator-facing quality read model for answer feedback.

Implemented shape:

- `app-api` quality summary now returns `runtime.feedback`.
- `app-api` quality timeseries now returns feedback denominator fields per bucket.
- `protected-panel-web` consumes those fields as quality summary cards and trend lines.
- HTTP contract and app-api schema docs now record the feedback denominator and join rules.

## Read Model Decision

Feedback aggregates are computed in `apps/app-api` query service by joining:

- `chat.message_feedback.request_id`
- `runtime.request_observability_fact.request_id`

The request observability fact remains the source for window and operator filters. Feedback
`updated_at` is not used to redefine quality windows. This keeps the read model app-api owned while
avoiding a premature `operator.metric_rollup.metrics_json` schema expansion.

## Denominators

- feedback coverage denominator: eligible assistant answers with status `completed`,
  `needs_clarification`, or `no_answer`
- helpful / unhelpful denominator: eligible answers that have feedback
- no-answer + unhelpful denominator: eligible `status=no_answer` answers
- `error`, `rejected`, and `approval_required` are excluded from feedback eligibility

## Verification

- RED then GREEN:
  `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/operator-query.store.test.ts`
- Route contract:
  `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/operator-query.route.test.ts`
- Protected panel targeted tests:
  `pnpm --dir apps/protected-panel-web exec vitest run -c vitest.node.config.mts test/data-provider.test.ts test/quality-domain.test.ts test/quality-page-formatters.test.ts test/overview-domain.test.ts`
- Typecheck:
  `pnpm --dir apps/app-api typecheck`
  `pnpm --dir apps/protected-panel-web typecheck`
- Docs:
  `pnpm docs:lint`
- Formatting / lint:
  `pnpm exec biome check ...` on touched Phase 3 TS/TSX/test files
