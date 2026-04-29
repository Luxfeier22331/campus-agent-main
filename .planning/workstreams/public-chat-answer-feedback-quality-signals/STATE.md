---
doc_type: state
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# State: Public Chat Answer Feedback And Quality Signals

## Current Status

- status: `completed`
- current slice: Phase 5 completed; workstream closeout ready for commit
- owner: current Codex session
- active implementation: app-api feedback truth, public-chat-web feedback UI, operator quality
  aggregates, negative feedback eval candidate export, and acceptance / rollout docs completed
- next phase: none

## Captured Context

2026-04-29 review / planning context:

- public-chat-web 旧 donor vote UI / `/api/vote` 不能直接恢复，因为它绕过 `app-api`
  owned product truth。
- `docs/architecture/system/product-runtime-architecture.md` 固定 public-chat-web 只通过
  same-site `/api/*` seam 调用 `apps/app-api`，不拥有 auth/session/conversation truth。
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
  固定 request projection 与 operator read model 由 `apps/app-api` 拥有。
- `docs/architecture/system/operator-observability-architecture.md` 已把 Quality 定位为
  `app-api` owned operator-facing read model。
- 当前 `chat.messages` 已有 assistant message、`kind`、`request_id` 与 structured parts，
  适合成为 feedback target，但尚无 feedback schema。

## Phase 0 Frozen Decisions

- Route shape:
  - `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
  - `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- Read path: conversation detail returns nullable feedback state on current owner assistant messages.
- Target: assistant messages with non-null `request_id`; feedback controls should only render for
  `kind in ('answer', 'clarification', 'no_answer')`.
- Request body: `vote: helpful | unhelpful`, optional `reasonCodes` for `unhelpful` only.
- Reason codes: `wrong_intent`, `not_enough_detail`, `outdated_or_missing_source`,
  `incorrect_answer`, `unclear_or_hard_to_use`, `other`.
- v1 does not accept free-form comment.
- Idempotency: latest row per owner user + assistant message.
- Delete: hard-delete current feedback row; no tombstone in v1.
- Metrics: coverage denominator is feedback-eligible assistant answers, not all requests.

## Blockers

- Phase 0 blockers resolved.
- Phase 1 completed with `0006_message_feedback.sql`, chat conversation service/store ownership,
  and app-api route exposure.
- Phase 2 completed with repo-owned `AnswerFeedback` compatibility type. Active message UI no longer
  passes donor `Vote` props or calls donor `/api/vote`.
- Phase 3 completed with direct app-api query-service aggregation from `chat.message_feedback` joined
  to `runtime.request_observability_fact`; `operator.metric_rollup.metrics_json` was not expanded.
- Phase 4 completed with `negative_feedback` candidates on
  `GET /api/operator/quality/eval-candidates` and eval-owned pending review manifest generation.
- Phase 5 completed with local DB bootstrap, smoke seed, browser feedback smoke, operator quality
  aggregate / eval candidate smoke, docs update, and rollout / rollback posture.

## Verification

- Phase 0 verification: docs diff review plus `pnpm docs:lint`.
- Phase 1 verification completed:
  - `pnpm --dir apps/app-api typecheck`
  - targeted `apps/app-api` Vitest coverage for chat conversation service/routes,
    structured parts, shared-product bootstrap contract, and auth/db auth suite
  - `pnpm docs:lint`
  - `pnpm exec biome check` on touched app-api TS/test files
- Phase 1 note: full `app-api` test still has an unrelated
  `official-web-local-projection-drain` timeout; touched feedback surfaces passed targeted tests.
- Phase 2 verification completed:
  - RED then GREEN targeted Worker/Vitest run:
    `pnpm --dir apps/public-chat-web exec vitest run -c vitest.config.mts
    test/chat-api.test.ts test/platform-chat-mappers.test.ts
    test/public-chat-interaction-closure.test.ts test/chatbot-vendor-runtime-parity.test.ts
    test/worker.test.ts`
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - `pnpm --dir apps/public-chat-web build`
  - `pnpm exec biome check` on touched public-chat-web TS/TSX/test files
  - `pnpm docs:lint`
- Phase 2 note: root `pnpm web:lint` still fails on unrelated existing/parallel worktree files
  outside this workstream, including app-api integration formatting, wechat collector/core
  formatting/lint, and official-web JSON formatting. Touched public-chat-web files pass targeted
  Biome.
- Phase 3 verification completed:
  - RED then GREEN:
    `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/operator-query.store.test.ts`
  - `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/operator-query.route.test.ts`
  - `pnpm --dir apps/protected-panel-web exec vitest run -c vitest.node.config.mts test/data-provider.test.ts test/quality-domain.test.ts test/quality-page-formatters.test.ts test/overview-domain.test.ts`
  - `pnpm --dir apps/app-api typecheck`
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm docs:lint`
  - `pnpm exec biome check` on touched Phase 3 TS/TSX/test files
- Phase 3 note: root `pnpm web:lint` was not used as the completion gate because this worktree
  already contains unrelated modified files from other workstreams; Phase 3 used targeted Biome on
  touched files.
- Phase 4 verification completed:
  - app-api store / service / route:
    `pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/operator-query.store.test.ts test/operator-query.service.test.ts test/operator-query.route.test.ts`
  - `pnpm --dir apps/protected-panel-web exec vitest run -c vitest.node.config.mts test/data-provider.test.ts`
  - `uv run --all-packages python -m unittest tests.evals.eval_admission_suite`
  - `pnpm --dir apps/app-api typecheck`
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm docs:lint`
  - targeted `pnpm exec biome check`
  - `uv run --all-packages ruff check ...`
  - `uv run --all-packages ruff format ... --check`
- Phase 5 verification completed:
  - `pnpm --dir apps/app-api db:bootstrap`
  - `pnpm --dir apps/app-api requests:seed-smoke`
  - local browser smoke through `pnpm --dir apps/public-chat-web dev:live-smoke`
  - browser smoke via `google-chrome` DevTools Protocol
  - operator quality summary / eval candidate smoke through app-api internal admission
  - `pnpm --dir apps/app-api test`
  - `pnpm --dir apps/public-chat-web typecheck`
  - `pnpm --dir apps/public-chat-web test:worker`
  - targeted app-api feedback/operator tests
  - targeted protected-panel operator tests
  - `pnpm --dir apps/protected-panel-web typecheck`
  - `pnpm docs:lint`
  - targeted `pnpm exec biome check`
  - `git diff --check`

## Continuity Notes

- 不要把 feedback 做进 `apps/supervisor-api`、`packages/rag-agent` 或 retrieval backend。
- 不要让 feedback 直接改变 capability routing、serving surface 或 ACL。
- 不要把 donor `/api/vote` 作为临时兼容层恢复；UI 恢复必须以 app-api route 为前置条件。
- negative feedback 只能作为质量诊断与 case-set sampling 输入，不能自动变成线上策略。
