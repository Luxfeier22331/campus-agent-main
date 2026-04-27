---
doc_type: plan
status: implemented-local
created: 2026-04-28
updated: 2026-04-28
phase: 7
---

# Plan: Type-aware Chat Source Surfaces And Notice Jump Contract

## Goal

Upgrade the current docs-only chat `source_cards` surface into a type-aware browser source list that can safely show canonical documents, public original notice URLs, notice reader targets, and restricted notice references without leaking retrieval or internal source locators.

## Why This Phase Reopens The Workstream

Phase 5 correctly established canonical reader source cards for RAG answers. The next admitted product requirement expands the browser-facing source surface: public chat answers will later cite notices, and some notice sources should jump to an original public notice URL instead of a docs reader page.

This belongs in `document-site-and-canonical-reader` because the user-facing source surface, canonical reader jump contract, docs highlight state, and public original-source jump semantics are one browser contract. It should not be handled as a campus-services runtime tool patch.

## External Design Basis

- W3C WCAG link-purpose guidance: link purpose must be clear from link text or its context.
- GOV.UK link guidance: external links should not surprise users; avoid ambiguous link text and unnecessary new-tab behavior.
- Material Design card/list guidance: use cards for a single clear entry point, but use explicit actions when an item may have more than one destination.
- Conversational answer source UX pattern: keep answer citations close to the answer, but use compact grouped source lists when source density grows.

## Scope

- Extend app-api browser source projection from docs-only `source_cards` to typed source items.
- Support at least these target kinds:
  - `canonical_reader`
  - `public_notice_url`
  - `notice_reader`
  - `restricted_notice`
- Preserve current canonical reader links, anchors, and highlight query semantics.
- Add public original notice URL allowlist policy and browser payload constraints.
- Redesign `public-chat-web` source rendering from heavy cards to compact type-aware source rows.
- Add regression coverage for projection, persistence normalization, frontend mapping, and rendered labels/actions.

## Non-goals

- No notice acquisition/provider work.
- No retrieval ranking or chunking changes.
- No docs reader asset pipeline rewrite.
- No restricted notice rollout beyond browser-facing source admission behavior.
- No panel source viewer or operator triage surface.

## Contract Shape

Replace implicit `href` semantics with explicit target fields:

```ts
type SourceTargetKind =
  | "canonical_reader"
  | "public_notice_url"
  | "notice_reader"
  | "restricted_notice";

type BrowserSourceItem = {
  targetKind: SourceTargetKind;
  sourceKind: "document" | "notice" | "regulation" | "curriculum" | "campus_service";
  title: string;
  snippet?: string;
  primaryAction: {
    label: "查看文档" | "打开原通知" | "查看整理版" | "需登录查看";
    href?: string;
    external?: boolean;
    disabledReason?: string;
  };
  secondaryActions?: Array<{
    label: "原通知" | "查看文档";
    href: string;
    external?: boolean;
  }>;
  sectionTitle?: string;
  collectionLabel?: string;
  publisherLabel?: string;
  publishedAt?: string;
  versionLabel?: string;
  pageLabel?: string;
  trustLabel?: string;
};
```

Compatibility rule: Phase 7 may keep the existing structured part name as `source_cards` only if the payload is versioned or migrated safely. The long-term browser semantics should be `source_items` or equivalent, not docs-only cards.

## Source Kind Rules

### Canonical Reader

- Allowed href: `/docs/...` relative paths only.
- Supports `?hl=<rootUnitIds>#<readerAnchor>`.
- Main action label: `查看文档`.
- May show collection, version, page, and section labels.

### Public Notice URL

- Allowed href: public HTTP(S) URL only after allowlist validation.
- Main action label: `打开原通知`.
- Must show publisher or source family when available.
- Should show publish date when available.
- Must not carry internal notice id or raw portal locator as browser parameters.

### Notice Reader

- Main action label: `查看整理版`.
- Secondary action may be `原通知` if a public original URL is allowlisted.
- If original URL is not public/allowlisted, omit the secondary action.

### Restricted Notice

- No raw portal URL for unauthorized public users.
- Main action label: `需登录查看` or no active action.
- May display a minimal source label only if that label is already safe for the current principal.
- Browser payload must not include object store keys, portal download URLs, raw notice ids, or private source locators.

## UX Requirements

- Render as a compact source list under the assistant answer.
- Default collapsed density: show up to 3 source rows, with an explicit expand control for more.
- Use type labels such as `文档`、`通知`、`整理版`、`需登录`.
- Do not make the whole row a single ambiguous link when secondary actions exist.
- Keep action labels specific; do not use generic `查看原文` across all source types.
- Keep snippets to at most two lines.
- Preserve keyboard focus and screen-reader link purpose.

## Implementation Plan

1. Add app-api source item model and normalization:
   - Define target kind, source kind, actions, labels, and safe metadata fields.
   - Preserve current docs source card projection through a compatibility mapper.
   - Reject browser payloads that include retrieval internals or private locators.

2. Add URL admission policy:
   - Keep `/docs/` allowlist for canonical reader.
   - Add public notice external URL allowlist for admitted public source channels.
   - Reject restricted/internal notice URLs unless the route is a same-site authorized reader route.

3. Update structured part projection:
   - Emit typed source items for completed RAG answers.
   - Continue dropping unsupported evidence rather than falling back to raw locators.
   - Deduplicate by canonical reader target or original public notice URL.
   - Keep max browser sources bounded.

4. Update persistence and API normalization:
   - Persist typed source items in chat message structured parts.
   - Normalize older `source_cards` records to typed source items for browser consumption.
   - Keep response payload backward-compatible enough for existing conversations.

5. Redesign public-chat-web rendering:
   - Replace the heavy source card block with compact rows.
   - Render source-kind label, title, context line, snippet, and explicit actions.
   - Use `打开原通知` for external public notice URL and `查看文档` for docs reader.
   - Add tests around labels, hrefs, collapsed/expanded behavior, and accessibility text.

6. Add acceptance tests:
   - app-api: docs source, public notice URL source, mixed reader + original notice source, restricted notice denied source.
   - public-chat-web: mapping and renderer tests for all target kinds.
   - guard tests: no `chunk_id`, no `source_unit_key`, no object storage key, no raw portal URL in unauthorized payload.

7. Smoke the user journey:
   - A docs-only RAG answer still shows `查看文档` and jumps with highlight.
   - A public notice-backed answer shows `通知` and `打开原通知`.
   - A mixed canonical notice reader answer shows `查看整理版` plus `原通知`.
   - Restricted notice path does not expose a private URL in public chat.

## Verification

- `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-structured-parts.test.ts`
- `pnpm --filter public-chat-web exec vitest run test/platform-chat-message-parts.test.ts test/platform-chat-mappers.test.ts test/vendor-chat-message.test.ts`
- `pnpm --filter app-api typecheck`
- `pnpm --filter public-chat-web typecheck`
- Browser smoke against `public-chat-web` once implementation begins.

## Decisions Closed

- The browser-facing structured part is `source_items`; legacy persisted `source_cards` are normalized into typed source items.
- Public original notice URL admission currently allows `https://muc.edu.cn`, `https://*.muc.edu.cn` except `my.muc.edu.cn`, and `https://mp.weixin.qq.com`.
- External original notice links use explicit `打开原通知` / `原通知` labels and do not force a new tab.

## Implementation Result

- `app-api` now exposes typed chat source item models and normalizes persisted `source_items`.
- Legacy `source_cards` records are mapped into canonical-reader source items for browser compatibility.
- Completed `rag-agent` answers now project `result.evidence.sources` into typed `source_items` instead of docs-only `source_cards`.
- Canonical reader links continue to require `/docs/...` relative paths and preserve `?hl=...#anchor`.
- Public notice original URLs are allowlisted before entering browser payloads.
- Restricted notice sources render as disabled `需登录查看` actions without raw portal URLs.
- `public-chat-web` maps shell `source_items` to AI SDK `data-source-items`.
- The Vercel Chatbot donor message renderer now shows a compact source list with source type labels, explicit actions, three-item default density, and expand/collapse for longer source sets.

## Verification Evidence

- Passed: `pnpm --filter public-chat-web typecheck`
- Passed: `pnpm --filter public-chat-web exec vitest run test/platform-chat-message-parts.test.ts test/platform-chat-mappers.test.ts test/vendor-chat-message.test.ts`
- Passed: `pnpm --filter app-api typecheck`
- Passed: `pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts test/chat-structured-parts.test.ts`
- Passed: `pnpm docs:lint`
- Passed: `pnpm exec biome check apps/app-api/src/modules/chat/index.ts apps/app-api/src/modules/chat/model.ts apps/app-api/src/modules/runtime-command/service/normalize.ts apps/public-chat-web/src/platform/chat/api-types.ts apps/public-chat-web/src/platform/chat/message-parts.ts apps/public-chat-web/src/platform/vendor-compat/lib/types.ts apps/public-chat-web/test/platform-chat-mappers.test.ts apps/public-chat-web/test/platform-chat-message-parts.test.ts apps/public-chat-web/test/vendor-chat-message.test.ts apps/public-chat-web/vendor/vercel-ai-chatbot/components/chat/message.tsx`
- Blocked outside this phase: `pnpm web:lint` still fails on unrelated dirty workstream files, including WeChat official account collector and existing app-api docs formatting diagnostics.

## Completion Criteria

- Planning documents mark Phase 7 active and scoped.
- The implementation migrates source display away from docs-only card semantics.
- Browser users can distinguish document, notice, reader, and restricted sources before clicking.
- Public chat never exposes raw retrieval or private notice locators.
- Regression tests cover mixed source kinds and existing docs source behavior.
