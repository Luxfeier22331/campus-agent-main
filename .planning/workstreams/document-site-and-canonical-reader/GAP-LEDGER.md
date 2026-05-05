---
doc_type: gap_ledger
status: completed
created: 2026-05-05
updated: 2026-05-05
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Document Site And Canonical Reader

## Completion Audit

This ledger maps the completed workstream to its accepted success criteria. It is
not a new implementation plan.

| Requirement Area | Completion Evidence | Residual Status |
|------------------|---------------------|-----------------|
| Independent docs browser surface | `apps/public-docs` is the docs shell; roadmap Phase 1-3 completed. | Closed |
| Published reader assets | `publish_document_reader_assets`, `docs:import-read-model`, `docs:export-public-sync-manifest`, `sync:published-reader-assets`, and `build:published-reader-assets` are documented in `STATE.md`. | Closed |
| App API docs control-plane | `apps/app-api` owns docs navigation, resolve, versions, search, and gated reader resolution. | Closed |
| Canonical reader jump contract | `/docs/...` canonical URLs preserve `?hl=...#anchor` and avoid browser-visible `chunkId`. | Closed |
| Public / restricted / historical reader handoff | Phase 6 verified unauthenticated gated `404`, authorized gated `200`, `no-store`, and `Vary: Cookie, Authorization`. | Closed |
| Public docs rendering quality | Rendering repairs for headings, enumerations, captions, wide tables, metadata, course maps, and native Rspress shell are documented in `STATE.md`. | Closed |
| Generated content hygiene | Generated docs, reader assets, course maps, and scaffold output are ignored and guarded by `lint:generated`. | Closed |
| Chat source surface | Phase 7 replaced docs-only `source_cards` semantics with typed `source_items` and compact `data-source-items` browser rendering. | Closed |
| Notice source jump safety | Public notice URLs are allowlisted; restricted notices render disabled `需登录查看` without portal URL or raw locator. | Closed |

## Verification Evidence

- Phase 6 staging gated reader smoke is recorded in `STATE.md`.
- Phase 7 source item projection and rendering verification is recorded in
  `phases/phase-7-type-aware-chat-source-surfaces-and-notice-jump-contract/SUMMARY.md`.
- Closeout verification was refreshed on 2026-05-05 with targeted app-api,
  public-chat, app-api typecheck, docs lint, repo-wide lint blocker evidence,
  and staging public-chat E2E blocker evidence recorded in `STATE.md`.

## Handoff

- Routine public-chat product-path smoke is not owned by this completed workstream.
- If notice source serving later enters public chat, end-to-end source jump
  validation belongs to the relevant public-chat product-entry acceptance lane.
- Reopen this workstream only if the docs reader contract, gated reader delivery,
  or browser source item safety contract regresses.
