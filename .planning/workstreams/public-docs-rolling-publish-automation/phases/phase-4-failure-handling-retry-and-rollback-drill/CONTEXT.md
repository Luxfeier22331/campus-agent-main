---
doc_type: context
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Context: Phase 4 Failure Handling, Retry, And Rollback Drill

## Problem

Phase 3 can run the scheduled deploy pipeline and append final `deployed` or
`failed` records, but the release system still lacks a complete operator-safe
failure and rollback contract.

The remaining risks are:

- Failed releases are recorded, but there is no retry classification or bounded
  retry command.
- The ledger captures Cloudflare deployment id when available, but rollback via
  Wrangler requires a Worker version id.
- Rollback is not yet represented as a first-class append-only ledger event.
- There is no machine-verifiable rollback drill proving previous-release
  continuity.
- The runbook does not yet tell operators which failures are retryable, which
  require upstream manifest fixes, and which require rollback.

## External Basis

Cloudflare Workers rollback current behavior:

- `wrangler rollback [<VERSION_ID>]` rolls back to the specified Worker version,
  or to the previous uploaded version when omitted.
- Rollback immediately creates a new deployment and makes that selected version
  active across deployed routes/domains.
- Rollback is limited to recent versions and can fail if external Developer
  Platform resources or bindings changed or disappeared.
- Cloudflare documents that resources connected to a Worker are not changed by
  rollback.

References:

- <https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/>
- <https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback>

## Accepted Direction

- Keep the ledger append-only.
- Treat rollback as a new release event with status `rolled_back`; do not mutate
  the old `deployed` record.
- Extend deployed ledger metadata to capture Worker version id separately from
  deployment id.
- Fail rollback preflight if the target deployed record cannot prove a
  rollbackable Worker version id, unless the operator explicitly supplies a
  version id.
- Keep rollback in CI / controlled runner / operator machine, not Worker
  runtime.
- Do not roll back app-api docs read-model inside `public-docs`; Phase 4 must
  instead document and test compatibility / continuity checks for the public docs
  bundle and gated static admission path.
- Phase 4 does not add deploy-hook nudging; that remains Phase 5.

## Current Implementation Hooks

- `apps/public-docs/scripts/run-published-reader-deploy-pipeline.ts`
- `apps/public-docs/scripts/check-published-reader-manifest.ts`
- `apps/public-docs/scripts/run-published-reader-scheduled-check.ts`
- `scripts/run-wrangler-command.mjs`
- `docs/runbooks/document-reader-publish-and-docs-deploy-runbook.md`
