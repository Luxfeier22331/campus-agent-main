---
doc_type: summary
status: complete
created: 2026-04-27
updated: 2026-04-27
phase: 5
---

# Summary: Chat Source Cards And Canonical Jump Integration

## Completed

- Added browser-safe `source_cards` structured part to `app-api` chat responses.
- Projected source cards from completed `rag-agent` evidence into canonical docs reader links.
- Enforced `/docs/` relative URL allowlist and dropped object storage / internal locator sources.
- Deduped repeated hits by canonical reader target rather than raw chunk identity.
- Preserved persisted `source_cards` through chat conversation detail normalization.
- Added `public-chat-web` source-card payload types and AI SDK `data-source-cards` mapping.
- Rendered compact “参考来源” cards in the existing Vercel Chatbot donor message component.
- Aligned the existing Streamdown code-highlighter adapter to Streamdown's current plugin type contract so `public-chat-web` typecheck can verify the donor message surface.

## Safety Contract

- Browser-facing payloads copy only title, section title, snippet, href, collection label, version label, and page label.
- The implementation does not copy `chunk_id`, `chunkId`, `source_unit_key`, `sourceUnitKey`, object storage keys, or raw source locators.
- Evidence without safe canonical reader URL is dropped instead of displayed with fallback internals.

## Verification

- Passed: `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-structured-parts.test.ts`
- Passed: `pnpm --filter public-chat-web exec vitest run test/platform-chat-message-parts.test.ts test/platform-chat-mappers.test.ts test/vendor-chat-message.test.ts`
- Passed: `pnpm --filter app-api typecheck`
- Passed: `pnpm --filter public-chat-web typecheck`
