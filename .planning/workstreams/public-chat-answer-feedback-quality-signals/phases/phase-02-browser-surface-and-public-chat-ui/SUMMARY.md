---
doc_type: phase_summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 2 Summary: Browser Surface And Public Chat UI

## Outcome

Phase 2 已完成 public-chat-web answer feedback UI。用户可对 eligible assistant answer
提交、修改或撤回 “有帮助 / 没有帮助” 反馈；所有写入通过 `app-api` feedback route，
donor `/api/vote` 保持关闭。

## Implemented

- Added typed public-chat-web app-api feedback helpers:
  - `setMessageFeedback`
  - `deleteMessageFeedback`
- Extended public-chat-web API and shell message types with `feedback`.
- Preserved current-user feedback state through app-api conversation detail mapping into UI
  messages.
- Replaced active donor `Vote` message props with repo-owned `AnswerFeedback` compatibility type.
- Updated assistant message actions:
  - copy remains available
  - helpful feedback submits immediately
  - unhelpful opens controlled reason choices
  - selected, pending, error, retry, and delete states are represented in the local UI
- Restricted feedback controls to finalized assistant messages with non-null `requestId` and
  `kind in ('answer', 'clarification', 'no_answer')`.
- Added same-site Worker forwarding coverage for the feedback route.

## Tests Added

- `apps/public-chat-web/test/chat-api.test.ts`
  - feedback PUT / DELETE helper route coverage
- `apps/public-chat-web/test/platform-chat-mappers.test.ts`
  - feedback state preservation through shell and UI message mapping
- `apps/public-chat-web/test/public-chat-interaction-closure.test.ts`
  - no donor `/api/vote` / donor DB query regression, app-api feedback control source checks
- `apps/public-chat-web/test/chatbot-vendor-runtime-parity.test.ts`
  - active message list uses feedback rather than donor `vote=` prop wiring
- `apps/public-chat-web/test/worker.test.ts`
  - same-site feedback write forwarding through APP_API binding

## Verification

- RED run confirmed missing helper / mapper / UI source coverage before implementation.
- GREEN targeted run:
  - `pnpm --dir apps/public-chat-web exec vitest run -c vitest.config.mts
    test/chat-api.test.ts test/platform-chat-mappers.test.ts
    test/public-chat-interaction-closure.test.ts test/chatbot-vendor-runtime-parity.test.ts
    test/worker.test.ts`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm --dir apps/public-chat-web test:worker`
- `pnpm --dir apps/public-chat-web build`
- `pnpm exec biome check` on touched public-chat-web TS/TSX/test files
- `pnpm docs:lint`

Root `pnpm web:lint` was also run and still reports unrelated existing/parallel worktree issues
outside this workstream. Touched public-chat-web files pass targeted Biome.

## Notes

- v1 still does not accept free-form comment.
- Feedback remains product quality signal only; it does not change routing, memory, authorization,
  serving surface, or supervisor admission.
- Phase 3 starts operator quality read model and metrics.
