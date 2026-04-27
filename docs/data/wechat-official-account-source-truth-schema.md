---
doc_type: data
status: active
created: 2026-04-27
updated: 2026-04-27
---
# WeChat Official-Account Source-Truth Schema

## Boundary

This document freezes the Phase 3 canonical source-truth schema for the
`wechat_official_account` source channel.

Phase 3 is metadata-first. FeedWe history currently provides public article
metadata such as id, title, URL, cover image, publish time, and account name.
It does not provide article body HTML in the accepted Phase 3 path, so this
schema records `bodyState: "not_captured"` instead of inventing body content.

This schema does not define notice projection, read-model rows, document
registry records, chunks, embeddings, serving aliases, or query runtime gates.

## Artifact Layers

Capture and provider artifacts remain owned by the collector:

- `provider/feedwe/provider-response.jsonl`
- `capture/feedwe-request-summary.json`

Article source-truth artifacts are written under the same source-channel
prefix:

- `source-truth/article-manifest.json`
- `source-truth/content-blocks.jsonl`
- `source-truth/media-refs.jsonl`

The object key shape is:

```text
wechat_official_account/{account_slug}/{year}/{article_version_id}/source-truth/article-manifest.json
wechat_official_account/{account_slug}/{year}/{article_version_id}/source-truth/content-blocks.jsonl
wechat_official_account/{account_slug}/{year}/{article_version_id}/source-truth/media-refs.jsonl
```

## Article Manifest

`article-manifest.json` is the article-level canonical upstream record.

Required fields:

- `schemaVersion`
- `sourceChannel`
- `accountName`
- `accountSlug`
- `articleStableId`
- `rawAssetId`
- `rawVersionId`
- `articleUrl`
- `normalizedArticleUrl`
- `articleIdentityBasis`
- `provider`
- `providerArticleId`
- `capturedAt`
- `titleRaw`
- `titleNormalized`
- `publishTime`
- `publishTimeSource`
- `coverImageUrl`
- `bodyState`
- `metadataHash`
- `blockCount`
- `mediaRefCount`
- `availabilityState`

Allowed first-version values:

- `sourceChannel`: `wechat_official_account`
- `provider`: `feedwe`
- `articleIdentityBasis`: `article_url` or `provider_article_id`
- `bodyState`: `not_captured`
- `availabilityState`: `observed`

## Content Blocks

`content-blocks.jsonl` stores only content that is actually present in the
provider metadata.

Phase 3 always writes one title block. It may write a summary block later if a
provider response includes a real summary field. It must not fabricate article
body paragraphs.

Each row contains:

- `schemaVersion`
- `rawAssetId`
- `rawVersionId`
- `rowId`
- `rowIndex`
- `blockOrder`
- `blockRole`
- `textRaw`
- `textNormalized`

Allowed first-version block roles:

- `title`
- `summary`

## Media Refs

`media-refs.jsonl` stores metadata-only media references. Phase 3 may record a
cover image URL but does not download the image.

Each row contains:

- `schemaVersion`
- `rawAssetId`
- `rawVersionId`
- `mediaRefId`
- `refOrder`
- `resourceRole`
- `sourceUrl`
- `normalizedSourceUrl`

Allowed first-version resource roles:

- `cover_image`

## Identity And Versioning

`articleStableId` and `rawAssetId` are derived from `accountSlug` plus the
best available stable article identity.

Identity precedence:

1. normalized article URL
1. provider article id

`rawVersionId` is derived from metadata that can affect downstream notice
projection:

- account identity
- normalized article URL
- provider article id
- normalized title
- publish time
- cover image URL

Capture time alone must not advance `rawVersionId`.

## Forbidden Fields

The source-truth layer must not contain:

- `document_id`
- `doc_id`
- `version_id`
- `revision_track`
- `chunk_id`
- `chunk_order`
- `embedding`
- `visibility_level`
- `visibility_scope`
- `entitlement_groups`
- `policy_projection_version`
- query-serving gate metadata
- notice read-model metadata

Those fields belong to projection, document registry, chunking, authorization,
or serving stages.

## Replay Boundary

When these source-truth artifacts exist, later notice projection must start
from `article-manifest.json`, `content-blocks.jsonl`, and `media-refs.jsonl`.

Provider response JSONL remains useful for audit and source-truth replay, but
it is not the long-term downstream contract.
