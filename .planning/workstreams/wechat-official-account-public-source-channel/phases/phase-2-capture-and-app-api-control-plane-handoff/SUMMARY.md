---
doc_type: summary
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 2 Summary: Capture And App-api Control-plane Handoff

## Outcome

Phase 2 is implemented. FeedWe capture now has a repo-owned collector runtime
that writes into the existing MinIO-backed source bucket through the existing
`OBJECT_STORE_*` source-bucket interface, and `app-api` owns run metadata,
artifact refs, and operator-visible capture status.

## Implemented

- Added `apps/wechat-official-account-collector`.
- Added FeedWe history-page capture for `GET /api/v1/articles/history`.
- Added page and article budget enforcement.
- Added ADR-0002 source-bucket artifact writes:
  - `wechat_official_account/{account_slug}/{year}/{raw_version_id}/provider/feedwe/provider-response.jsonl`
  - `wechat_official_account/{account_slug}/{year}/{raw_version_id}/capture/feedwe-request-summary.json`
- Added app-api collector control-plane routes:
  - `POST /api/wechat-official-account/runs`
  - `POST /api/wechat-official-account/runs/:runId/heartbeats`
  - `POST /api/wechat-official-account/runs/:runId/finalize`
- Added operator-visible status routes:
  - `GET /api/operator/wechat-official-account/runs`
  - `GET /api/operator/wechat-official-account/runs/:runId`
- Added app-api PG ledger tables under schema `wechat_official_account`.
- Added env examples for FeedWe, collector app-api handoff, and source-bucket
  config.
- Collector capture failures finalize the app-api run as `failed` with a
  redacted terminal error before the CLI exits.

## Boundaries

- FeedWe remains acquisition only.
- App-api stores metadata and artifact refs, not provider bytes.
- Collector writes only `provider/` and `capture/` artifacts in Phase 2.
- No source-truth, projection, document registry, Qdrant, release alias, notice
  read model, or query-serving runtime writes were added.

## Verification

Focused verification added for:

- FeedWe response parsing and pagination.
- Page/article budget enforcement.
- Secret redaction by omission from artifacts.
- Source-bucket object key shape.
- App-api ledger artifact refs.
- Rejection of source-truth/projection artifact refs in Phase 2.
- Collector credential fail-closed behavior.
- Collector failure finalization and terminal error redaction.

## Follow-up

Phase 3 should define the provider-agnostic WeChat article source-truth and
replay contract before notice consumption projection opens.
