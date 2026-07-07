---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-07-06
---

# Local Runtime Smoke

## Boundary

Repo-owned shell wrappers for local execution-control, Qdrant and generated
runtime env are retired. Local development may still run services directly, but
the repository does not maintain a second lifecycle platform beside
Kubernetes/GitOps.

This runbook records the supported local checks after a developer has started
the required services through their chosen platform.

## Required Inputs

Local commands read explicit env files only:

- root `.env`
- app-specific `.env`
- app-specific `.dev.vars` where the app owns Worker runtime vars
- command-scoped files under `env/commands/`

The repo no longer generates local runtime env bundles or local runtime
secrets. Missing provider, database, Qdrant, Temporal or Hindsight values must
be supplied through explicit local env or the platform deployment.

## App And Worker Checks

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
pnpm --dir apps/operator-console-web test:worker -- --reporter=verbose
```

Provider-config local seeding remains an app-api script and requires explicit
env:

```bash
node apps/app-api/scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/seed-local-provider-config.ts --stage prompt
node apps/app-api/scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/seed-local-provider-config.ts --stage embedding
```

Projection refresh is explicit and writes reviewed artifacts:

```bash
node scripts/sync-provider-config-projection.mjs \
  --output .tmp/provider-config-projection.json
node scripts/sync-observability-config-projection.mjs \
  --output .tmp/observability-config-projection.json
```

## Execution Runtime Check

Before local chat E2E, execution-control must already be reachable:

```bash
curl -sS http://127.0.0.1:27051/healthz
curl -sS http://127.0.0.1:27051/readyz
```

Then run the app-level E2E:

```bash
pnpm --dir apps/app-api chat:e2e:dev
```

`chat:e2e:dev` does not start or restart execution-control. A missing runtime is
a blocker, not a signal to recreate local lifecycle scripts.
