---
doc_type: context
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Context: Phase 3 Build, Smoke, And Deploy Pipeline Integration

## Problem

Phase 1 can validate the current public docs manifest and Phase 2 can run that
check on the accepted Shanghai schedule with a single-flight lock. The remaining
gap is that a valid `changed` manifest still does not advance into the controlled
`apps/public-docs` build, smoke and deploy path.

Without this phase, the scheduled runner can prove a candidate exists but cannot
publish it or record the Cloudflare deployment evidence that makes the release
auditable.

## Accepted Direction

- Reuse the Phase 2 scheduled check as the admission gate.
- Run build / smoke / deploy only when the check verdict is `changed`.
- Preserve skip behavior for `not_due`, `lock_busy`, `unchanged`, `invalid` and
  `blocked`.
- Execute commands through an injectable command runner so tests never call
  Cloudflare.
- Keep the release ledger append-only:
  - Phase 2 appends the manifest-check record.
  - Phase 3 appends a final `deployed` or `failed` deployment record.
- Capture Cloudflare deployment id when the deploy command exposes one.
- Do not implement retry, rollback or deploy-hook nudging in this phase.

## Existing Repo Hooks

`apps/public-docs` already exposes:

- `build:published-reader-assets`
- `deploy:verify-config`
- `deploy:verify-config:staging`
- `run-published-reader-scheduled-check.ts`
- `check-published-reader-manifest.ts`

Phase 3 adds the missing orchestration layer around these hooks instead of
making browser/runtime code inspect object storage.
