---
doc_type: plan
status: complete
created: 2026-04-27
updated: 2026-04-27
phase: 5
---

# Plan: Chat Source Cards And Canonical Jump Integration

## Requirements

1. `app-api` owns source-card projection from supervisor evidence to browser-safe structured parts.
2. Source cards are emitted only for completed `rag-agent` answers.
3. Source cards accept only `/docs/` relative canonical reader URLs.
4. Source-card hrefs use query-before-hash format: `?hl=...#anchor`.
5. Duplicate evidence for the same canonical document/anchor collapses to one card.
6. Browser payloads never include retrieval internals or object storage locators.
7. `public-chat-web` maps `source_cards` to AI SDK `data-source-cards` parts.
8. The donor Vercel Chatbot message renderer shows a compact “参考来源” block with “查看原文” links.

## Implementation Steps

1. Extend `apps/app-api` chat model with `ChatSourceCard` and `source_cards` structured part normalization.
2. Add `normalizeSourceCardsPart` in runtime-command finalization, gated by `selectedTarget === "rag-agent"` and `status === "completed"`.
3. Build source-card hrefs from safe canonical URL, reader anchor, and root unit highlight IDs.
4. Drop evidence that cannot map to a safe `/docs/` reader URL.
5. Extend `public-chat-web` API and vendor-compat types for source-card payloads.
6. Map shell structured parts to AI SDK `data-source-cards`.
7. Render compact source cards inside the existing Vercel Chatbot donor message component.
8. Add regression tests for projection, persistence normalization, frontend mapping, and donor renderer coverage.

## Verification

- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-structured-parts.test.ts`
- `pnpm --filter public-chat-web exec vitest run test/platform-chat-message-parts.test.ts test/platform-chat-mappers.test.ts test/vendor-chat-message.test.ts`
- `pnpm --filter app-api typecheck`
- `pnpm --filter public-chat-web typecheck`
