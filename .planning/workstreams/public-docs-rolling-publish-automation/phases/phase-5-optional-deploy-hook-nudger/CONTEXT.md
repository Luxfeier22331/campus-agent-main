---
doc_type: context
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Context: Phase 5 Optional Deploy Hook Nudger

## Problem

Phase 1-4 provide scheduled rolling publish, deployment ledger, retry and
rollback. The remaining latency gap is that ingestion can publish a new current
manifest shortly after a scheduled window and then wait up to six hours before
the next automatic check.

Phase 5 adds an optional nudge path so an upstream manifest publication event can
request an immediate public-docs check. This must not create a second publishing
truth source.

## External Basis

Cloudflare Workers Deploy Hooks provide a unique URL that triggers a build with
an HTTP `POST`. Cloudflare documents that:

- the unique URL acts as the credential and does not require a separate
  Authorization header;
- hook URLs must be stored as secrets;
- repeated requests while a build is queued or initializing return the existing
  build instead of creating a duplicate;
- hook-triggered builds are labeled as deploy hook builds in Workers Builds.

Reference:

- <https://developers.cloudflare.com/workers/ci-cd/builds/deploy-hooks/>

## Accepted Direction

- A hook event is only a nudge.
- The payload may identify `surface`, `environment`, `eventId` and source
  metadata, but it must not provide trusted manifest digest, release id or
  object keys.
- The runner must still read the configured current manifest pointer/path and run
  the same manifest validation, digest comparison and single-flight lock.
- The same deploy pipeline decides `changed / unchanged / invalid / blocked`.
- The ledger trigger may be `hook`, but deployed truth remains the manifest
  digest and successful deploy record.
- Cloudflare Deploy Hook URL support is optional and is represented as a
  dispatch client; tests must not call the real network.

## Current Implementation Hooks

- `apps/public-docs/scripts/run-published-reader-deploy-pipeline.ts`
- `apps/public-docs/scripts/check-published-reader-manifest.ts`
- `apps/public-docs/scripts/run-published-reader-scheduled-check.ts`
- Phase 4 retry/rollback ledger metadata
