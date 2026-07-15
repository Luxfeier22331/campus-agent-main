---
doc_type: data
truth_scope: domain
owner_boundary: official-web
status: active
created: 2026-04-02
updated: 2026-07-13
---
# Official Web Data

## Object Storage

Official-web task boundaries use digest-pinned S3-compatible refs.

Inputs:

- `official_web_capture_request.v1`
- `official_web_crawl_preparation.v1`, containing due candidates and the
  configured seed URLs already represented in freshness state

Outputs include page source evidence, normalized observations, crawl quality
artifacts, and one `official_web_source_manifest.v1` result manifest. The
result returned to Temporal is `ingestion_task_result.v1`, which points at that
manifest and carries only a bounded scalar summary.

Canonical pages use `official_web_page_manifest.v2`; the run bundle uses
`official_web_source_truth_bundle.v2` and pins five refs per retained page:
manifest, content blocks, provider extraction, discovered links and response
HTML. Every ref crossing a runtime boundary includes a SHA-256 digest and byte
size. Consumers read the result manifest to find detailed artifacts and verify
each referenced object before use.

Canonical page manifests and content blocks exclude fetch timestamps, headers,
redirects, discovery metadata and target planning. Those values are stored
below `runs/<run-id>/attempts/<activity-attempt>/...`. An existing object key is
accepted only when digest and size match, so unchanged retries cannot mutate
canonical bytes.

## PostgreSQL

Ingestion-control owns two latest-state official-web projections:

```text
ingestion_control.official_web_url_freshness
ingestion_control.official_web_seed_state
```

URL freshness is keyed by:

```text
(site_id, normalized_canonical_url)
```

It stores:

- normalized URL/host and page classification;
- discovery method/source;
- last fetch disposition and HTTP status;
- content type and HTTP validators;
- response/main-content hashes;
- seen/changed/not-modified timestamps;
- cadence, priority, next eligible time;
- last successful run id and bounded change reason.
- last observed run id used with the observation timestamp as the upsert order.

Seed state is keyed by:

```text
(site_id, configured_seed_url)
```

It records the canonical URL most recently observed for each configured seed.
The two identities are deliberately separate: an HTTP redirect can make a
configured seed URL resolve to another canonical URL, and multiple configured
seeds can resolve to the same canonical page. Seed state prevents unnecessary
bootstrap fetches without duplicating canonical URL freshness rows.

The collector emits `configuredSeedUrl` explicitly on page observations only
when the current request came from configuration. Ingestion-control never
infers configured-seed identity from `discoveryMethod`, because later freshness
recrawls retain historical discovery metadata.

Both tables are latest-state scheduling input, not crawl-run ledgers. Page
bytes, artifact inventories, workflow attempts, release gates, target jobs,
and online serving state do not belong in these tables.

Rows are updated only when the incoming `(observed_at, run_id)` tuple is newer
than the stored tuple. This resolves equal-time concurrent runs without making
arrival order database truth.

## Data Boundaries

- Temporal stores workflow history and activity heartbeat/retry state.
- Object storage stores source evidence and detailed observations.
- PostgreSQL stores latest URL freshness and configured-seed identity.
- Qdrant receives nothing from official web in the current implementation.
- App-api owns no official-web schema.

## Retention

Object retention is an environment policy. Deleting or compacting old source
artifacts must never mutate Temporal history or pretend the URL was never
observed. Freshness and seed-state rows may be rebuilt only from verified
observation artifacts; they must not be inferred from app-api or online
retrieval data.

## Related Documents

- `docs/architecture/domains/official-web/architecture.md`
- `docs/architecture/system/data-plane.md`
- `apps/ingestion-control/migrations/0001_tasks.sql`
