# stable_reference collection config

This directory holds the repo-tracked serving config for the `stable_reference`
collection within the `official_web` corpus.

- source-level crawl ownership remains under
  `configs/sources/official_web/muc_public/`
- this collection profile describes the stable-reference serving scope for
  public-web content derived from `official_web` source truth

Profile declaration:

- serving stage: `query_serving`
- serving surface: `stable_reference`
- query policy: default-open in runtime scope when a published alias exists
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
- repo-tracked retrieval qrels: the eval-langfuse-owned
  `official_web_stable_reference` retrieval dataset

Boundary notes:

- this collection is reserved for public-web stable reference pages such as
  institution overview, department/contact pages, and long-lived explanatory
  content
- brand-history, school-history-person, celebrity-biography, and promotional
  honor pages are not part of the default stable-reference answer denominator;
  keep them in source/inventory audit truth unless a dedicated brand-history
  surface is admitted
- config declares the intended alias `official_web_stable_reference`; a target is
  query-ready only after document units, chunks, index, release manifest and
  alias publish evidence exist
- it is the only default query-enabled official-web surface; `fresh_news`
  remains explicitly out of the default online answer path
- it is not a mirror for formal regulations or formal curriculum documents;
  those continue to belong to `regulations/*` and `curriculum/*`
- replay and QC now target explicit active collections
- current `source_truth_materialize` tasks only verify source-truth refs; they
  do not by themselves create stable-reference documents, chunks, indexes or a
  published alias
