---
doc_type: plan
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 2: Capture And App-api Control-plane Handoff

## Goal

Implement the FeedWe capture/control-plane handoff without introducing a new
storage or file-layout system. Phase 2 must use the repo's existing MinIO source
bucket through the existing `OBJECT_STORE_*` interface and ADR-0002 file
architecture, then let `app-api` own run ledger, artifact refs, and
operator-visible status.

Phase 2 does not define the final WeChat article source-truth schema and does
not open notice query-serving.

## Storage And File Architecture Decision

Use the current repo storage stack:

- deployment target for this workstream: existing local/shared MinIO
- access path: existing source-bucket interface
- source bucket env: `OBJECT_STORE_BUCKET_SOURCE`
- credential/env owner: existing `OBJECT_STORE_*` configuration
- file layout: ADR-0002 source-channel conventions

Do not introduce:

- a third bucket
- repo-tracked captured JSON blobs
- local filesystem truth
- a source-channel-specific custom layout outside ADR-0002

## Artifact Layout

Phase 2 writes only source-channel acquisition artifacts. It should reuse these
ADR-0002 families:

- `capture/`
- `provider/`
- `source-truth/` only as an empty future boundary, not a Phase 2 output unless
  Phase 3 schema is already frozen
- `projection/` only for declared projection artifacts after Phase 3/4

Initial FeedWe history-page responses should be mirrored as provider artifacts,
not as canonical source truth.

Proposed source prefix shape:

```text
wechat_official_account/{account_slug}/{year}/{raw_version_id}/provider/feedwe/provider-response.jsonl
wechat_official_account/{account_slug}/{year}/{raw_version_id}/capture/feedwe-request-summary.json
```

Where:

- `account_slug` is a stable normalized official-account identifier.
- `year` comes from article publish time when article-level identity is known;
  otherwise from capture time for page-level acquisition artifacts.
- `raw_version_id` is content-hash based for provider response pages, and later
  article-id/content-hash based when Phase 3 freezes article source truth.

If Phase 2 needs run-level manifests, they must be recorded as app-api ledger
artifact refs plus source-bucket artifacts following the same source-channel
prefix style. Do not add a new top-level run artifact convention without
documenting it in ADR-0002/data-plane docs.

## App-api Control-plane Handoff

`app-api` should own:

- run admission status
- run lifecycle status
- artifact refs
- provider request summary
- redacted failure reason
- article/page counts
- operator-visible status

`app-api` should not own:

- provider response bytes in Postgres
- source-truth transformation
- document registry writes
- Qdrant/index writes
- notice query-serving opening

## Implementation Tasks

1. Define FeedWe capture request shape.
   - env: `FEEDWE_API_KEY`, `FEEDWE_BASE_URL`
   - endpoint: `GET /api/v1/articles/history`
   - query: `names`, `begin`, `size`
   - enforce page budget and max article count

2. Define MinIO source-bucket artifact writer.
   - use existing MinIO / `OBJECT_STORE_*` config
   - write provider response as JSONL or normalized JSON artifact
   - write request summary without secrets
   - compute content hash for artifact refs

3. Define app-api ledger contract.
   - run id
   - source channel `wechat_official_account`
   - provider `feedwe`
   - status lifecycle
   - artifact refs and hashes
   - counts and redacted errors

4. Add guardrails.
   - no API key in logs, artifacts, snapshots, planning, or fixtures
   - no document registry/Qdrant/release alias writes
   - no query-serving side effects

5. Add tests.
   - FeedWe response fixture parsing
   - pagination and budget enforcement
   - secret redaction
   - MinIO source-bucket object-key shape
   - app-api ledger artifact refs
   - no downstream serving side effects

## Acceptance Criteria

- Phase 2 plan uses the existing MinIO source bucket and source-bucket
  interface.
- Artifact paths follow ADR-0002 source-channel families.
- FeedWe capture output is mirrored before downstream processing.
- `app-api` ledger stores metadata/artifact refs, not provider bytes.
- No new storage abstraction, bucket, local directory truth, or custom file tree
  is introduced.
- Focused tests cover pagination, redaction, artifact refs, and no serving side
  effects.
