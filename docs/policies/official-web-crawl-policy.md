---
doc_type: policy
truth_scope: domain
owner_boundary: official-web
status: active
created: 2026-04-02
updated: 2026-07-13
---
# Official Web Crawl Policy

## Admission

- A crawl runs only as registry task `official_web.capture`.
- The request is a digest-pinned `official_web_capture_request.v1` object.
- `site_id` must resolve to repo-owned source configuration.
- Host filters may narrow configured hosts but cannot add hosts.
- Page and host budgets are positive, bounded request fields.

## Discovery

- Configured seeds start the first crawl.
- Later crawls use the bounded freshness preparation from ingestion-control.
- Robots, configured sitemaps, robots-discovered sitemaps, navigation links, and
  explicit requeue are the only discovery methods.
- A discovered URL is normalized and checked against site/host policy before
  fetch.

## Fetch And Extraction

- Prefer HTTP fetch; use browser rendering only when policy and page behavior
  require it.
- Respect robots and configured concurrency/rate limits.
- Preserve canonical URL, status, validators, content type, timestamps, hashes,
  discovery provenance, title, page family, and extracted main content.
- Listing/navigation pages can be discovery evidence without becoming retained
  answer-bearing content.
- A parse or quality failure remains explicit; do not silently substitute raw
  full-page text as accepted main content.

## Incremental Behavior

- Send prior ETag/Last-Modified when available.
- `304` updates not-modified freshness without rewriting page content.
- Matching content hashes do not create a false change.
- Deleted and failed fetches remain explicit dispositions with a next eligible
  retry time.
- Successful observations update latest URL freshness only after result and
  page-observation digests validate.

## Runtime Behavior

- Temporal owns retry, timeout, heartbeat, and cancellation.
- Coarse progress uses activity heartbeat; per-page details use object-store
  artifacts.
- The collector does not call app-api or ingestion-control HTTP lifecycle
  endpoints from inside the activity.
- Missing config, credentials, preparation, or artifact integrity fails the
  task; there is no live-search or provider fallback.

## Serving

Crawl success is not publication. Official-web artifacts remain offline until
a separate serving chain is implemented and admitted.

## Related Documents

- `docs/architecture/domains/official-web/architecture.md`
- `docs/data/official-web.md`
- `configs/sources/official_web/muc_public/README.md`
