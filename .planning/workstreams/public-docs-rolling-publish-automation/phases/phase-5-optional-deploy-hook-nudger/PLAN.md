---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

# Plan: Phase 5 Optional Deploy Hook Nudger

## Goal

Add a safe optional hook nudger that can trigger the existing public-docs rolling
publish pipeline immediately after ingestion publishes a new current manifest,
without trusting webhook payload data as release truth.

## Requirements

- Accept only `surface=public_docs`.
- Optionally validate `environment` in payload against the runner environment.
- Support shared-secret validation for local/CI webhook adapters.
- Ignore payload-provided manifest digest, release id, object key or branch.
- Run existing deploy pipeline with `trigger=hook` and `force=true`.
- Preserve single-flight lock, manifest validation and no-change skip behavior.
- Support an optional Cloudflare Deploy Hook dispatch client for Workers Builds.
- Never call a real deploy hook URL in tests.
- Record hook trigger metadata in returned result and ledger where applicable.

## Implementation Tasks

1. Add tests first.
   - Suggested file:
     `apps/public-docs/test/nudge-published-reader-deploy-hook.test.ts`.
   - Cover invalid surface rejection, environment mismatch rejection, shared
     secret rejection, payload manifest digest ignored, local pipeline hook
     trigger, Cloudflare deploy hook dispatch, CLI arg parsing.

2. Extend release trigger type.
   - File:
     `apps/public-docs/scripts/check-published-reader-manifest.ts`.
   - Add `hook` to ledger `trigger` union.

3. Extend deploy pipeline trigger input.
   - File:
     `apps/public-docs/scripts/run-published-reader-deploy-pipeline.ts`.
   - Add optional `trigger` input.
   - Preserve existing default behavior:
     - `force=true` without explicit trigger remains `forced`.
     - scheduled run remains `scheduled`.
   - Hook nudger passes `trigger=hook`.

4. Add nudger module and CLI.
   - Suggested file:
     `apps/public-docs/scripts/nudge-published-reader-deploy-hook.ts`.
   - Export:
     - `validatePublishedReaderDeployHookPayload()`
     - `triggerCloudflareDeployHook()`
     - `nudgePublishedReaderDeployHook()`
     - CLI arg parser
   - Support:
     - `--env`
     - `--payload-json`
     - `--payload-path`
     - `--secret`
     - `--payload-secret`
     - `--deploy-hook-url`
     - existing manifest / ledger / lock args for local pipeline mode

5. Add package script.
   - `nudge:published-reader-deploy-hook`

6. Update runbook and workstream docs.
   - Explain hook payload is not trusted.
   - Explain Cloudflare Deploy Hook URL must be treated as a secret.
   - Explain hook dispatch vs local pipeline mode.
   - Explain idempotency expectations.

## Verification

```bash
pnpm --filter public-docs test -- \
  test/nudge-published-reader-deploy-hook.test.ts \
  test/run-published-reader-deploy-pipeline.test.ts \
  test/check-published-reader-manifest.test.ts
pnpm --filter public-docs typecheck
pnpm --filter public-docs exec biome check \
  scripts/nudge-published-reader-deploy-hook.ts \
  scripts/run-published-reader-deploy-pipeline.ts \
  scripts/check-published-reader-manifest.ts \
  test/nudge-published-reader-deploy-hook.test.ts \
  package.json
pnpm docs:lint
```

## Done Criteria

- Hook payload cannot bypass manifest validation.
- Hook nudge can run the local controlled deploy pipeline with `trigger=hook`.
- Hook nudge can dispatch a Cloudflare Workers Deploy Hook URL through injected
  fetch in tests.
- Invalid surface/environment/secret fail closed before pipeline execution.
- Runbook documents secret handling and idempotency.
