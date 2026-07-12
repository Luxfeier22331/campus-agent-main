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

Local development may use the canonical Docker Compose file as a
developer/diagnostic harness, but the repository does not maintain a second
staging lifecycle platform beside Kubernetes/GitOps.

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

The canonical local execution-runtime harness is
`infra/local/docker-compose.execution-runtime.yml`. It defaults to the
debug OTel collector and does not require external sink credentials. Add
`infra/local/docker-compose.execution-runtime.fanout.yml` only when
testing Langfuse/Axiom fan-out; use
`infra/local/docker-compose.langfuse.yml` only when the run needs
a local self-hosted Langfuse stack.

## App And Worker Checks

```bash
pnpm --dir apps/app-api test:worker -- --reporter=verbose
pnpm --dir apps/campus-web test:worker -- --reporter=verbose
pnpm --dir apps/operator-console-web test:worker -- --reporter=verbose
```

Provider-config local seeding remains an app-api script and requires explicit
env:

```bash
pnpm --dir apps/app-api exec tsx ./scripts/run-with-local-env.ts pnpm exec tsx \
  ./ops/dev/seed-local-provider-config.ts --stage prompt
pnpm --dir apps/app-api exec tsx ./scripts/run-with-local-env.ts pnpm exec tsx \
  ./ops/dev/seed-local-provider-config.ts --stage embedding
```

Projection refresh is explicit and writes reviewed artifacts:

```bash
pnpm exec tsx apps/execution-control/scripts/sync-provider-config-projection.ts \
  --output .tmp/provider-config-projection.json
```

## Execution Runtime Check

Before local chat E2E, execution-control must already be reachable:

```bash
curl -sS http://127.0.0.1:27051/healthz
curl -sS http://127.0.0.1:27051/readyz
```

Then run the app-level E2E:

```bash
pnpm smoke:app-api -- chat-dev
```

`chat-dev` does not start or restart execution-control. A missing runtime is a
blocker, not a signal to recreate local lifecycle scripts.
