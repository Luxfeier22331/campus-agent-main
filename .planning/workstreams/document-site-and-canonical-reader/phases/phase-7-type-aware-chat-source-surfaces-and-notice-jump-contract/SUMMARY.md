---
doc_type: summary
status: implemented-local
created: 2026-04-28
updated: 2026-04-28
phase: 7
---

# Summary: Type-aware Chat Source Surfaces And Notice Jump Contract

## Completed

- Added `source_items` as the browser-facing chat source structured part.
- Preserved legacy `source_cards` by normalizing them into typed canonical-reader source items.
- Projected completed `rag-agent` evidence into typed source items with explicit `targetKind`, `sourceKind`, primary action, secondary actions, and safe user-facing metadata.
- Kept canonical reader jumps constrained to `/docs/...` and preserved `?hl=...#anchor` highlight semantics.
- Added public notice original URL admission for school public domains and public WeChat article URLs.
- Represented restricted notice sources as disabled `需登录查看` actions without exposing private portal URLs or raw locators.
- Updated `public-chat-web` mapping to emit AI SDK `data-source-items`.
- Replaced the docs-only heavy source card UI with compact rows showing source type, context, snippet, and explicit actions such as `查看文档`, `打开原通知`, `查看整理版`, and `原通知`.

## Verification

- Passed: `pnpm --filter public-chat-web typecheck`
- Passed: `pnpm --filter public-chat-web exec vitest run test/platform-chat-message-parts.test.ts test/platform-chat-mappers.test.ts test/vendor-chat-message.test.ts`
- Passed: `pnpm --filter app-api typecheck`
- Passed: `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-structured-parts.test.ts`
- Passed: `pnpm docs:lint`
- Passed: `pnpm exec biome check apps/app-api/src/modules/chat/index.ts apps/app-api/src/modules/chat/model.ts apps/app-api/src/modules/runtime-command/service/normalize.ts apps/public-chat-web/src/platform/chat/api-types.ts apps/public-chat-web/src/platform/chat/message-parts.ts apps/public-chat-web/src/platform/vendor-compat/lib/types.ts apps/public-chat-web/test/platform-chat-mappers.test.ts apps/public-chat-web/test/platform-chat-message-parts.test.ts apps/public-chat-web/test/vendor-chat-message.test.ts apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx`

## Repo-level Follow-up Verification

- Passed after targeted lint cleanup: `pnpm web:lint`
