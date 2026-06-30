---
doc_type: data
truth_scope: data
owner_boundary: domains/authenticated-notice
status: active
created: 2026-04-27
updated: 2026-04-28
---
# WeChat Official-Account Source-Truth Schema

## Boundary

This document freezes the canonical source-truth schema for the
`wechat_official_account` source channel.

FeedWe is the discovery provider only. The accepted capture path is:

1. fetch FeedWe history for article discovery
1. fetch the real `mp.weixin.qq.com/s/...` article URL
1. derive canonical source-truth from the fetched WeChat article page

The canonical source-truth is the real WeChat article page plus the media bytes
captured in the same collector run. It must not invent body content or defer
inline image acquisition to later OCR stages.

This schema does not define notice projection, read-model rows, document
registry records, chunks, embeddings, serving aliases, or query runtime gates.

## Artifact Layers

Capture and provider artifacts remain owned by the collector:

- `provider/feedwe/provider-response.jsonl`
- `capture/feedwe-request-summary.json`
- `capture/wechat-article-fetch-metadata.json`
- `capture/wechat-article-page.html`
- `provider/wechat-page-parser/page-extraction.json`
- `capture/media/{media_identity}/original.{ext}`
- `capture/media/{media_identity}/fetch-metadata.json`

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

After a collector run has a run id, the collector writes a run-level release
object:

```text
wechat_official_account/{account_slug}/runs/{run_id}/capture-release.json
```

`capture-release.json` uses
`wechat_official_account_capture_release.v1` and contains only
same-source-bucket references to article source-truth objects:

- `article_source_truth_refs[].manifest_ref`
- `article_source_truth_refs[].content_blocks_ref`
- `article_source_truth_refs[].media_refs_ref`

This object is the ingestion-control task input for
`wechat_public_notice/campus_notices/wechat_public_notice/
source_truth_materialize`. It is not a query-serving artifact and does not
replace article-level source-truth.

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
- `captureBoundary`
- `pageKind`
- `pageParserVersion`
- `capturedPageFinalUrl`
- `inlineImageCount`
- `capturedInlineImageCount`
- `failedInlineImageCount`

Allowed current values:

- `schemaVersion`: `wechat_official_account_article_manifest.v2`
- `sourceChannel`: `wechat_official_account`
- `provider`: `feedwe`
- `articleIdentityBasis`: `article_url` or `provider_article_id`
- `bodyState`: `captured`, `not_captured`, or `fetch_failed`
- `availabilityState`: `observed`
- `captureBoundary`: `real_mp_weixin_page`
- `pageKind`: `article`, `verification`, `non_article`, or `fetch_error`

## Content Blocks

`content-blocks.jsonl` stores only content that is actually present in the
canonical source page or trusted provider metadata.

The collector always writes one title block. It may also write:

- one summary block when the page exposes a real summary
- one or more `body_paragraph` blocks when the real WeChat page body is
  captured successfully

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
- `body_paragraph`

## Media Refs

`media-refs.jsonl` stores referenced media URLs from the captured article page
and the capture state of each media object. The collector may record the cover
image plus inline image URLs. Captured media bytes are stored under `capture/`;
source-truth stores only stable object metadata and fetch status.

Each row contains:

- `schemaVersion`
- `rawAssetId`
- `rawVersionId`
- `mediaRefId`
- `refOrder`
- `resourceRole`
- `sourceUrl`
- `normalizedSourceUrl`
- `captureStatus`
- `finalUrl`
- `objectKey`
- `contentSha256`
- `mimeType`
- `byteSize`
- `capturedAt`
- `fetchErrorMessage`

Allowed current values:

- `schemaVersion`: `wechat_official_account_media_ref.v2`
- `cover_image`
- `inline_image`
- `captureStatus`: `captured` or `fetch_failed`

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
- normalized summary text
- normalized body paragraph content
- normalized inline image URLs
- page parser version / fetch projection inputs

Capture time alone must not advance `rawVersionId`, but a changed captured body
must.

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

## Notice Projection Handoff

This source channel is admitted into an offline notice-consumption projection
lane:

- source family: `wechat_public_notice`
- source corpus/collection: `campus_notices/wechat_public_notice`
- primary role default: `notice_window`
- semantic owner default: `notice_body`

Projection must consume only source-truth artifacts from this document and must
not read raw provider bytes at query time.

Deterministic dedupe precedence is:

1. `internal_notice_restricted`
1. `official_web_public_notice`
1. `wechat_public_notice`

When a WeChat article is deduped by higher precedence truth, projection keeps a
suppressed audit row with:

- `target_surface = "unsupported"`
- `consumption_status = "no_adoption"`
- dedupe evidence in `role_metadata`

Projection may emit read-model rows through the unified notice family runtime,
but only rows with captured body and completed multimodal requirements are
queryable:

- retained rows with `bodyState = "captured"` may materialize canonical notice
  markdown and become queryable notice rows
- retained rows with `bodyState = "not_captured"` or `fetch_failed` remain
  non-queryable reference/audit rows
- no separate WeChat query runtime is introduced

## Replay Boundary

When these source-truth artifacts exist, later notice projection must start
from `article-manifest.json`, `content-blocks.jsonl`, and `media-refs.jsonl`.

Provider response JSONL remains useful for audit and source-truth replay, but
it is not the long-term downstream contract. The repo-owned collector command
path for producing new source-truth is the real article capture path, not a
metadata-only provider-response replay CLI.

Ingestion-control admission starts from `capture-release.json`. `app-api`
WeChat routes remain run-ledger/projection surfaces and must not become the
source-truth lifecycle owner.
