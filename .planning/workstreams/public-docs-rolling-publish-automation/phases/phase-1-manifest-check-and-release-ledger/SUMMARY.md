---
doc_type: summary
status: implemented-local
created: 2026-04-29
updated: 2026-04-29
---

# Summary: Phase 1 Manifest Check And Release Ledger

## Implemented

- Added `apps/public-docs/scripts/check-published-reader-manifest.ts`.
- Added `pnpm --filter public-docs check:published-reader-manifest`.
- Added manifest digest comparison against the last successful deployed ledger record.
- Added dry-run JSON verdicts:
  - `changed`
  - `unchanged`
  - `invalid`
  - `blocked`
- Added release ledger schema and append helper with deployed-state validation.
- Added validation gates for:
  - manifest schema and `surface=public_docs`
  - source object existence
  - `asset-manifest.json` hash / size checks
  - duplicate target paths
  - public vs gated static target separation
- Updated the document reader publish/deploy runbook with the pre-build
  manifest check.

## Not Implemented In Phase 1

- Scheduled runner.
- Single-flight lock.
- Build / smoke / deploy orchestration.
- Cloudflare deployment id capture.
- Rollback automation.
- Deploy-hook nudger.

These remain in later phases by design.

## Evidence

- `.planning/workstreams/public-docs-rolling-publish-automation/evidence/phase-1-manifest-check-and-release-ledger/verification.md`
