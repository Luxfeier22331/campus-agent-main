---
doc_type: data
truth_scope: domain
owner_boundary: authenticated-notice
status: active
created: 2026-04-27
updated: 2026-07-13
---
# WeChat Official Account Data

## Boundary

FeedWe discovers article history. Canonical source evidence comes from the real
WeChat article page and media fetched during the same collector activity. This
data is offline source truth, not a notice read model or query-serving target.

## Request

`wechat_official_account_capture_request.v1` contains account identity and
bounded page/article controls. The request is stored in the source bucket and
submitted through `wechat_official_account.capture`.

## Article Artifacts

Each article version may contain:

- attempt-scoped provider response and request summary;
- attempt-scoped fetched article HTML and fetch metadata;
- parser extraction;
- canonical captured cover/inline media plus attempt-scoped fetch metadata;
- `source-truth/article-manifest.json`;
- `source-truth/content-blocks.jsonl`;
- `source-truth/media-refs.jsonl`.

`wechat_official_account_article_manifest.v3` preserves stable account/article
identity, canonical URL, provider identity, publish time, normalized title,
body state, page kind/parser version, hashes, block/media counts, and media
capture outcomes. Content blocks contain only observed title/summary/body text.
`wechat_official_account_media_ref.v3` preserves source/final URL, object key,
digest, type, size, status, and failure details. Capture timestamps are not
canonical fields.

Unchanged retries must produce byte-identical article manifests and media refs.
Raw page HTML, FeedWe summaries and page/media fetch metadata are stored under
`runs/<run-id>/attempts/<activity-attempt>/...`.

## Capture Release

After capture the worker writes:

```text
wechat_official_account/<account_slug>/runs/<run_id>/attempts/<activity_attempt>/capture-release.json
```

The release contains same-bucket refs to article manifests, content blocks, and
media refs. The worker verifies those refs and writes
`wechat_official_account_source_manifest.v1`, then returns one
`ingestion_task_result.v1` ref with bounded counts.

## Storage Boundary

- Object storage owns source artifacts and releases.
- Temporal owns execution state and attempts.
- PostgreSQL stores only the shared ingestion task projection.
- App-api has no WeChat collector routes, tokens, run ledger, or projection
  tables.

## Downstream Boundary

Deduplication against another source, notice normalization, authorization,
publication, chunking, and online retrieval are future downstream contracts.
They must not mutate the captured article evidence.

## Related Documents

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/architecture/system/data-plane.md`
