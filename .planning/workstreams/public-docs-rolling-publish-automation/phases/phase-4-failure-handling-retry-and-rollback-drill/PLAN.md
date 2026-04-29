---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

# Plan: Phase 4 Failure Handling, Retry, And Rollback Drill

## Goal

Complete the failure-handling and rollback contract for `apps/public-docs`
rolling publish automation. After this phase, failures, retries and rollback
must be machine-verifiable and represented in the append-only release ledger.

## Non-goals

- Do not implement deploy-hook / webhook nudging.
- Do not execute real production rollback in automated tests.
- Do not move deploy or rollback execution into Worker runtime.
- Do not modify the canonical reader data model.
- Do not roll back `app-api` docs read-model from `public-docs`; only verify and
  document compatibility expectations.

## Required Design Decisions

### Retry Policy

Use a bounded, explicit retry model:

- `invalid` / `blocked` manifest verdicts are not retryable. Required action is
  upstream manifest / reader asset repair.
- `unchanged`, `not_due` and `lock_busy` are not release failures and are not
  retryable by the release retry command.
- Build / smoke / verify failures are not automatically retried in the same run;
  they require a new controlled retry after the underlying cause is fixed or
  confirmed transient.
- Deploy command infrastructure failures may be retried by an explicit retry
  command if the candidate manifest digest is still current and no newer
  deployed record exists.
- Retry attempts are append-only ledger records with `retryOfRecordId` and
  `attemptNumber`; they do not mutate the failed record.

### Rollback Target

Rollback target resolution must be deterministic:

- Default target: previous successful `deployed` record in the same environment.
- Explicit target: `--target-release-id` or `--target-version-id`.
- A rollback target must have a Worker version id. If the ledger only has a
  deployment id, preflight must fail unless `--target-version-id` is supplied.
- Rollback must use `wrangler rollback <VERSION_ID> --message <message>` through
  `scripts/run-wrangler-command.mjs`.
- Staging uses `--env staging --config wrangler.toml`; prod uses
  `--config wrangler.toml`.

### Ledger Shape

Extend `PublicDocsReleaseLedgerRecord` with optional fields:

- `cloudflareVersionId`
- `retryOfRecordId`
- `attemptNumber`
- `rollbackTargetRecordId`
- `rollbackTargetReleaseId`
- `rollbackTargetVersionId`
- `rollbackReason`
- `rollbackCommand`

These fields must remain optional for backward compatibility with Phase 1-3
ledger records.

### Rollback Evidence

Rollback success requires:

- A `rolled_back` ledger record.
- The rollback command result.
- The target version id and source deployed record id.
- A post-rollback smoke result, at minimum build/static-admission contract level
  for local tests and command planning.
- A continuity assertion that the previous deployed record remains discoverable
  and no failed release was promoted to `deployed`.

## Implementation Tasks

1. Add Phase 4 tests first.
   - Suggested files:
     - `apps/public-docs/test/published-reader-release-retry-policy.test.ts`
     - `apps/public-docs/test/rollback-published-reader-release.test.ts`
   - Cover non-retryable manifest failures, retryable deploy command failures,
     attempt numbering, stale candidate rejection, rollback target resolution,
     missing version id fail-close, dry-run rollback planning and successful
     rollback ledger append.

2. Extend release ledger types and validation.
   - File:
     `apps/public-docs/scripts/check-published-reader-manifest.ts`.
   - Add optional retry / rollback / version id fields.
   - Keep old ledger records valid.
   - Add validation that `rolled_back` records reference a rollback target.

3. Capture Worker version id during deploy.
   - File:
     `apps/public-docs/scripts/run-published-reader-deploy-pipeline.ts`.
   - Parse version id separately from deployment id.
   - Append `cloudflareVersionId` on successful `deployed` records when present.
   - If Wrangler output does not expose a version id, preserve deploy success but
     mark rollback readiness as incomplete in the result.

4. Add retry policy module.
   - Suggested file:
     `apps/public-docs/scripts/published-reader-release-retry-policy.ts`.
   - Export pure functions:
     - `resolvePublicDocsReleaseRetryDecision()`
     - `findRetryBaseRecord()`
     - `resolveNextAttemptNumber()`
   - Do not execute commands from this module.

5. Add retry command integration.
   - Either extend `run-published-reader-deploy-pipeline.ts` or add a small
     wrapper script.
   - Suggested package script:
     `retry:published-reader-release`.
   - The retry command must:
     - Read the ledger.
     - Select a failed record.
     - Confirm no newer successful deployed record supersedes it.
     - Confirm the current manifest digest still matches the failed candidate.
     - Run the same build/smoke/verify/deploy pipeline with retry metadata.

6. Add rollback command.
   - Suggested file:
     `apps/public-docs/scripts/rollback-published-reader-release.ts`.
   - Suggested package script:
     `rollback:published-reader-release`.
   - Support:
     - `--env`
     - `--ledger`
     - `--lock-file`
     - `--target-release-id`
     - `--target-version-id`
     - `--reason`
     - `--dry-run`
   - Use the same single-flight lock family as deploy.
   - Run `node ../../scripts/run-wrangler-command.mjs rollback <version-id>`
     with `--env staging` when needed.

7. Add rollback post-check / drill support.
   - Keep automated tests dry-run / injected-runner only.
   - Add a local drill command path that can prove command planning and ledger
     append without Cloudflare side effects.
   - Record dry-run evidence under the Phase 4 evidence directory.

8. Update runbook and workstream docs.
   - Document retryable vs non-retryable outcomes.
   - Document rollback preflight.
   - Document required version id evidence.
   - Document Cloudflare rollback limitations around external resources /
     bindings.
   - Preserve Phase 5 as the deploy-hook nudger phase.

## Verification

```bash
pnpm --filter public-docs test -- \
  test/published-reader-release-retry-policy.test.ts \
  test/rollback-published-reader-release.test.ts \
  test/run-published-reader-deploy-pipeline.test.ts \
  test/check-published-reader-manifest.test.ts
pnpm --filter public-docs typecheck
pnpm --filter public-docs exec biome check \
  scripts/published-reader-release-retry-policy.ts \
  scripts/rollback-published-reader-release.ts \
  scripts/run-published-reader-deploy-pipeline.ts \
  scripts/check-published-reader-manifest.ts \
  test/published-reader-release-retry-policy.test.ts \
  test/rollback-published-reader-release.test.ts \
  package.json
pnpm docs:lint
```

## Done Criteria

- Retry policy is explicit, tested and fail-closed.
- Retry command cannot retry `invalid` / `blocked` manifests or stale failed
  candidates.
- Successful deploy records can carry Worker version id for rollback.
- Rollback command can resolve a target release and plan / execute
  `wrangler rollback <VERSION_ID>`.
- Rollback fails closed when target version evidence is missing.
- Rollback appends `rolled_back` ledger records without mutating old records.
- Runbook explains operator actions for failure, retry and rollback.
- No automated test performs a real Cloudflare deploy or rollback.
