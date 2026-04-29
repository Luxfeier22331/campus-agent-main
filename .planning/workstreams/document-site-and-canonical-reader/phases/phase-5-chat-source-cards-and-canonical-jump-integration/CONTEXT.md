---
doc_type: context
status: complete
created: 2026-04-27
updated: 2026-04-27
phase: 5
---

# Context: Chat Source Cards And Canonical Jump Integration

## Goal

Public chat answers should expose browser-safe canonical source cards that jump to the document reader, without leaking retrieval internals.

## Scope

- Add a `source_cards` structured chat part beside the existing `place_card` part.
- Project source cards in `app-api` from completed `rag-agent` evidence only.
- Preserve the Vercel Chatbot donor shell and render cards through AI SDK data parts.
- Link cards to `/docs/:corpus/:collection/:documentSlug?hl=...#anchor`.

## Non-Goals

- Do not change retrieval ranking, evidence selection, chunking, or RAG prompt behavior.
- Do not introduce a new chat UI shell or custom chat framework.
- Do not expose restricted documents, historical compare, `as_of` search, or gated reader handoff in this phase.
- Do not expose `chunkId`, `sourceUnitKey`, object storage keys, raw source locators, or internal Qdrant/source IDs to browser payloads.

## Inputs

- Existing `ChatMessageStructuredPart` model in `apps/app-api`.
- Existing `structuredParts` mapping in `apps/public-chat-web`.
- Existing Vercel Chatbot donor message renderer and AI SDK `UIMessage` data parts.
- Existing document reader IA under `/docs/:corpus/:collection/:documentSlug`.
