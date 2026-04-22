# muc_public_pages collection config

This directory holds the repo-tracked runtime profile and retrieval fixture
manifest for the `muc_public_pages` collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection config only defines offline ingestion/runtime truth for the
  declared projection target `official_web/muc_public_pages`

Current runtime truth:

- serving stage: `offline_preparation`
- serving surface: `mixed`
- query enabled: `false`
- freshness-sensitive queries supported: `false`
- live-search fallback allowed: `false`
- serving alias: `muc_public_pages`
- collection prefix: `muc_public_pages`
- retrieval qrels manifest: `split-manifest.v1.json`

`muc_public_pages` is the first offline document home for `official_web`
projection replay outputs. It is not part of the default query-serving surface.
This profile exists so replay/import, document registry writes, and future
release-managed indexing all operate against an explicit repo-tracked
`corpus/collection` scope.

Current serving-surface interpretation:

- the collection still mixes stable-reference-like pages and future fresh-news
  candidates
- it is therefore a local QC / replay / forced-validation collection, not a
  freshness-ready answer surface
- `今天` / `最新` / `最近` style asks must fail closed under the current runtime truth
  instead of being treated as supported official-web answers
- its long-term successors are `official_web/stable_reference`,
  `official_web/fresh_news`, and `official_web/news_archive`
- formal regulations and formal curriculum documents still belong to
  `regulations/*` and `curriculum/*`, not to new `official_web/*` mirror scopes

Current ingestion policy:

- handoff replay stages projection output and quality evidence by default
- only explicit promoted batches are allowed to mutate registry current truth
- release validation fails closed when the scope is too small or still contains
  `listing_page` / `generic_content_page` style staged-only output
- `split-manifest.v1.json` in this directory is only for repo-tracked retrieval
  qrels validation; its page ranges are synthetic sequential placeholders, not
  source-truth splitting semantics for official web pages
