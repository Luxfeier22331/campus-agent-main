---
doc_type: phase_summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 1 Summary: App API Feedback Truth

## Outcome

Phase 1 已完成 `app-api` owned answer feedback durable truth。public-chat-web 仍未恢复 UI；
下一步是 Phase 2 browser surface。

## Implemented

- Added `chat.message_feedback` shared-product migration:
  - `apps/app-api/db/shared-product-migrations/0006_message_feedback.sql`
- Added Drizzle schema export:
  - `messageFeedback`
  - `appApiSchema.messageFeedback`
- Extended chat message response model with optional assistant `feedback` state.
- Extended chat conversation store:
  - load current owner feedback into conversation detail
  - validate owner conversation + assistant message + non-null request id
  - upsert latest feedback by owner user + assistant message
  - hard-delete current feedback
- Extended chat conversation service:
  - `setMessageFeedback`
  - `deleteMessageFeedback`
  - vote / reason-code validation
  - no free-form comment
- Added browser-surface routes:
  - `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
  - `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- Updated route exposure inventory, app-api HTTP contract, app-api schema docs, and app-api README.

## Tests Added

- `apps/app-api/test/chat-conversations.service.test.ts`
  - upsert feedback
  - invalid reason handling
  - delete feedback
- `apps/app-api/test/chat-conversations.route.test.ts`
  - PUT / DELETE feedback routes
  - malformed body rejection
- `apps/app-api/test/shared-product-bootstrap.contract.test.ts`
  - shared migration file exists
  - `messageFeedback` schema export exists

## Verification

- `pnpm --dir apps/app-api typecheck`
- targeted `apps/app-api` Vitest coverage for chat conversation service/routes,
  structured parts, shared-product bootstrap contract, and auth/db auth suite
- `pnpm docs:lint`
- `pnpm exec biome check` on touched app-api TS/test files

## Notes

- Full `app-api` test still has an unrelated `official-web-local-projection-drain` timeout.
  Touched feedback surfaces pass targeted tests.
- Phase 2 must not restore donor `/api/vote`; it should call the new `app-api` feedback routes.
