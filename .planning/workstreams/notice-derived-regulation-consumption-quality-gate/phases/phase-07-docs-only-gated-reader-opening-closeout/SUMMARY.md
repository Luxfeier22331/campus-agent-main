---
doc_type: phase_summary
status: completed
created: 2026-04-28
updated: 2026-04-28
workstream: notice-derived-regulation-consumption-quality-gate
phase: 07
---
# Phase 07 Summary: Docs-Only Gated Reader Opening Closeout

<!-- markdownlint-disable MD013 -->

## Completed

- Added a gated collection fallback page for `public-docs` so restricted collection landing routes
  can render an app shell without publishing anonymous static MDX.
- Tightened app-api docs navigation so a gated-only collection returns `docs_collection_not_found`
  to readers without matching entitlement.
- Extended staging gated docs smoke args/script with
  `--gated-collection-navigation-path`, plus collection navigation checks for title/canonical URL
  and storage locator non-leakage.
- Re-ran selected `354006` dry-run and formal import into `regulations/scoped_rules`.
- Imported the generated docs read-model manifest into PG.
- Exported public-docs sync manifest and built published reader assets; the local build contains the
  `354006` `_gated-docs/regulations/scoped_rules/.../reader.json` asset.
- Added a public-docs local env runner so published reader sync commands load repo/app env before
  reaching object storage.

## Results

- Dry-run selected notices: `["354006"]`.
- Dry-run materialized documents: `1`.
- Dry-run target scope counts:
  - `regulations/institutional_rules=0`
  - `regulations/scoped_rules=1`
- Formal import `docs_only_opened=true`.
- Formal import `query_serving_opened=false`.
- Formal import `rag_release_opened=false`.
- Docs read-model import result:
  `collections=1`, `documents=1`, `readerAssets=1`, `searchUnits=1`.
- Public-docs sync manifest entry count: `117`.
- Public-docs generated asset copy result:
  `copiedDocumentCount=117`, `copiedGatedDocumentCount=2`,
  `copiedPublicDocumentCount=115`.

## Staging Smoke Handoff

The staging gated docs smoke was attempted with the generated `354006` gated reader path and
`/api/docs/collections/regulations/scoped_rules/navigation`. It was blocked before docs assertions
because staging app-api `/readyz` returned `503` due to supervisor readiness:

```text
dependency_not_ready: Supervisor readiness probe returned 503.
```

This is a live staging runtime readiness blocker, not a local selected import/build failure. Real
browser/staging acceptance should resume after staging supervisor readiness is restored.

## Closeout

This phase closes the repo-owned docs-only opening path for one accepted regulation notice. Future
work should reopen only for new accepted regulation notice families, docs/RAG/query-serving opening
policy changes, or live staging acceptance drift.
