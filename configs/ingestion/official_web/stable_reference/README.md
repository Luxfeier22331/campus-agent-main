# stable_reference collection config

This directory holds the repo-tracked runtime profile for the `stable_reference`
collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection is the future stable-reference serving scope for public-web
  content derived from `official_web` source truth

Current runtime truth:

- serving stage: `query_serving`
- serving surface: `stable_reference`
- query enabled: `true`
- freshness-sensitive queries supported: `false`
- live-search expansion allowed: `false`
- required metadata fields: `none`
- primary evidence page families: `repo policy decides by stable-reference
  semantics; not restricted to news-only detail pages`
- listing-page role: `n/a`
- serving alias: `official_web_stable_reference`
- collection prefix: `official_web_stable_reference`
- repo-tracked split manifest:
  `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`
- repo-tracked retrieval qrels:
  `packages/eval-langfuse/fixtures/rag/official_web_stable_reference/retrieval_qrels.json`

Boundary notes:

- this collection is reserved for public-web stable reference pages such as
  institution overview, department/contact pages, and long-lived explanatory
  content
- brand-history, school-history-person, celebrity-biography, and promotional
  honor pages are not part of the default stable-reference answer denominator;
  keep them in source/inventory audit truth unless a dedicated brand-history
  surface is admitted
- it is now the first query-enabled `official_web/*` surface and should be
  consumed through the published alias `official_web_stable_reference`
- it is the only default query-enabled official-web surface; `fresh_news` and
  `news_archive` remain explicitly out of the default online answer path
- it is not a mirror for formal regulations or formal curriculum documents;
  those continue to belong to `regulations/*` and `curriculum/*`
- `official_web/muc_public_pages` remains the mixed bridge for replay, QC, and
  regression truth; it is no longer the forward-facing official-web query
  surface
