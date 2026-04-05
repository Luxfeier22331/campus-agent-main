## fresh_news collection config

This directory holds the repo-tracked runtime profile for the `fresh_news`
collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection is the future freshness-sensitive news serving scope for
  `official_web`

Current runtime truth:

- serving stage: `offline_preparation`
- serving surface: `fresh_news`
- query enabled: `false`
- freshness-sensitive queries supported: `false`
- live-search fallback allowed: `false`
- serving alias: `official_web_fresh_news`
- collection prefix: `official_web_fresh_news`
- repo-tracked split manifest:
  `configs/ingestion/official_web/fresh_news/split-manifest.v1.json`
- repo-tracked retrieval qrels:
  `packages/evals/fixtures/official_web_fresh_news_retrieval_qrels.json`

Boundary notes:

- this collection is reserved for news, notices, activities, lectures, and
  media-style public-web content
- the current handoff input remains the `future_fresh_news_surface` subset in
  `official_web/muc_public_pages`, and `projection-routing.json` now routes
  that fixed seed set into `official_web/fresh_news`
- declaring this profile and baseline does not mean the collection is already
  query-ready
- freshness gate, live-search fallback, and release validation for news remain
  separate follow-up work
