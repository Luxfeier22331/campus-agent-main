---
doc_type: plan
status: implemented-local
created: 2026-04-27
updated: 2026-04-27
---

# Phase 6 Plan: Restricted / Historical Reader Handoff And Acceptance

## Goal

Turn restricted reader from schema-level posture into an enforced browser delivery seam while keeping public and historical reader URLs on the same canonical reader model.

## Implementation

- Extend `app-api` docs service from public-only filtering to principal-visible filtering for summary, navigation, versions, and resolve.
- Keep default docs search public-current only; do not open restricted or historical search in this phase.
- Add server-only gated asset source resolution that maps `reader | outline | meta | asset-manifest` to `docs.reader_assets.source_objects_json`.
- Add `GET /api/docs/collections/:corpus/:collection/documents/:documentSlug/assets/:assetKind` and stream authorized gated asset bytes from `DOCS_READER_ASSETS`.
- Keep browser JSON responses free of object keys, raw locators, provider paths, source unit keys, and chunk ids.
- Keep `public-docs` deploy sync public-only; `gated_asset` entries remain absent from `doc_build/_docs`.
- Add explicit `public-docs` reader handoff shells for docs routes that miss static assets, so restricted/historical docs resolve through same-site `/api/docs/*` without using static content as a substitute.

## Acceptance

- Unauthorized restricted reader resolve and asset lookup fail closed.
- Authorized principal with matching entitlement groups receives gated same-site asset URLs.
- Gated asset endpoint repeats authorization and returns `Cache-Control: no-store` and `Vary: Cookie, Authorization`.
- Public current and public historical reader descriptors continue to use static asset URLs.
- Static `public-docs` build still succeeds with generated docs.

## Known Follow-Up

Cloudflare staging now has a dedicated reader asset R2 bucket bound as `DOCS_READER_ASSETS`. Real staging restricted byte acceptance still requires syncing the gated reader asset objects into that bucket before deployment smoke.
