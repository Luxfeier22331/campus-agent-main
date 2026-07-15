# stable_reference collection

This directory defines the offline `official_web/stable_reference` collection
for long-lived public web pages such as institutional, department, and contact
references.

## Current Boundary

- `serving-config.json` is `offline_preparation` with retrieval disabled.
- The collection is absent from
  `configs/runtime/query-serving-targets.v1.json`; `knowledge_query` cannot
  select or search it.
- Qdrant names in the serving config reserve artifact identity only and do not
  assert that an online alias exists.
- Formal regulations and curriculum documents remain in their owning corpora.

## Ingestion

This collection has no executable task registry. `official_web.capture` only
produces source artifacts and URL freshness state. Canonical document,
chunk/index, release, and serving publication must be implemented together
before this collection can gain executable tasks or become an online target.
