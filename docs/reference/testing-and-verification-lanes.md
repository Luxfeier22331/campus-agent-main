---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-31
updated: 2026-06-28
---
# Testing And Verification Lanes

## Boundary

This document names the stable verification lanes and their meaning. It does not
replace architecture, app-local README commands, release runbooks or CI
configuration.

## Repo Lanes

- `pnpm repo:guard`
  - Fast collaboration / docs structure / workspace layout guard.
  - Not a lint, build, test, runtime or release proof.
- `pnpm repo:static`
  - Repo-wide static gate for live tracked surfaces: docs, configs, env examples,
    JSON/YAML/TOML/HTML/SQL/XML/JSONL/shell/Dockerfile checks, Biome, Ruff format
    checks and decomposition guard.
  - Not a typecheck, unit test, integration test or E2E proof.
- `uv run --all-packages python -m unittest discover -s tests -t .`
  - Repo Python baseline through `uv` / `unittest`.
- `pnpm web:typecheck`, `pnpm web:test`, `pnpm web:build`,
  `pnpm ci:web-graph:full`
  - JS/TS stable graph checks.
  - `pnpm web:test` is the stable default lane, not all Worker / integration
    tests.
- `pnpm web:test:worker`
  - Explicit Worker runtime lane for app-api, campus-web and
    operator-console-web.
- `pnpm web:test:integration`
  - Explicit external dependency integration lane; currently app-api shared DB
    integration.

## App / Runtime Lanes

- `pnpm --dir apps/app-api test`
  - App-api default Node lane.
- `pnpm --dir apps/app-api test:worker`
  - App-api Worker runtime lane.
- `pnpm --dir apps/app-api test:shared-db-integration`
  - Shared Postgres / Better Auth integration lane.
- `pnpm --dir apps/campus-web test`
  - Campus-web Worker lane.
- `pnpm --dir apps/operator-console-web test`
  - Operator-console-web Worker lane.
- `cd apps/execution-control && go test ./...`
  - Go unit / integration lane using package tests and Temporal test
    environment where applicable.
- `cd apps/execution-control && go test -tags temporal_e2e ...`
  - Explicit Temporal dev-server / test-server lane. It is not part of the
    default Go lane.

## Release / Staging Lanes

- `docs/runbooks/e2e-qa-release.md`
  - Real staging release QA. It requires real deployment, auth/session, browser
    surfaces, data plane and observability sinks.
  - It must not use fallback expectations, skipped auth, skipped readyz or
    `--expect-result-kind any` to pass.
- `docs/runbooks/rag-release.md`
  - Fresh RAG collection release / rebuild acceptance for current query-serving
    collections.
- `docs/runbooks/execution-smoke.md`
  - Execution-control staging smoke.
- `docs/runbooks/worker-observability-smoke.md`
  - Forward Worker observability preflight / post-deploy smoke.

## Rules

- Run the smallest lane that proves the changed surface, then broader repo gates
  when the change crosses boundaries.
- Do not treat release evidence as main-chain architecture completion.
- Do not treat static/lint success as runtime correctness.
- Do not mix integration lanes into the default stable gate unless the changed
  surface requires external dependency proof.
- Record exact commands in PRs and final handoff; do not write "should pass".
