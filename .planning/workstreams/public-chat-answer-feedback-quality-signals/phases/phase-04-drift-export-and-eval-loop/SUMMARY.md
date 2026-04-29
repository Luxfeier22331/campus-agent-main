---
doc_type: phase_summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Summary: Drift Export And Eval Loop

## Outcome

Phase 4 completed the first negative-feedback-to-eval candidate path.

Implemented shape:

- `app-api` now exports `negative_feedback` candidates through
  `GET /api/operator/quality/eval-candidates`.
- Existing badcase-derived candidates remain supported.
- `detectedBy=negative_feedback` returns only user negative feedback candidates.
- Default eval candidate queries can merge badcase and negative feedback candidates.
- `packages/evals` can wrap app-api negative feedback candidates into a pending quality review
  manifest through `build_quality_feedback_candidate_review_manifest`.

## Candidate Shape

Negative feedback candidates include:

- request id / trace id
- conversation id / assistant message id
- answer kind
- typed intent summary
- citation posture
- feedback id, vote, reason codes, updated time
- suggested review labels:
  `false_positive`, `false_negative`, `wrong_intent`, `stale_missing_evidence`,
  `answer_style_issue`
- privacy flags that remain false for raw transcript, raw auth material, and provider raw response

## Boundary

This phase does not write eval truth and does not generate accepted benchmark artifacts.

The path is:

`app-api quality eval-candidates -> packages/evals pending review manifest -> manual/eval-owner admission`

Accepted eval cases still need to be rewritten into eval-owned case models.

## Verification

- app-api store / service / route:
  `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/operator-query.store.test.ts test/operator-query.service.test.ts test/operator-query.route.test.ts`
- Protected panel data provider:
  `pnpm --dir apps/protected-panel-web exec vitest run -c vitest.node.config.mts test/data-provider.test.ts`
- Eval admission:
  `uv run --all-packages python -m unittest tests.evals.eval_admission_suite`
- Typecheck:
  `pnpm --dir apps/app-api typecheck`
- Typecheck:
  `pnpm --dir apps/protected-panel-web typecheck`
- Lint / format:
  `pnpm exec biome check ...`
- Lint / format:
  `uv run --all-packages ruff check packages/evals/src/campus_evals/eval_admission.py tests/evals/eval_admission_suite.py`
- Docs:
  `pnpm docs:lint`
