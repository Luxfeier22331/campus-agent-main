---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-31
updated: 2026-06-29
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
    JSON/YAML/TOML/HTML/SQL/XML/JSONL/shell/Dockerfile checks, HTML checker,
    Biome, Ruff format checks and decomposition guard.
  - The lane is based on tracked + current worktree files selected by the repo
    checker; untracked 文件 are not proof of branch-tip compliance until they
    are intentionally added.
  - The HTML checker validates tracked + untracked 文件 matched by the live
    HTML pathspecs; it is part of repo static structure proof, not browser
    runtime proof.
  - PowerShell 继续保留为 supplemental lane，不并入默认 `pnpm repo:static`。
  - Not a typecheck, unit test, integration test or E2E proof.
- `pnpm repo:static:affected`
  - Local changed-file static lane against `origin/develop`.
  - Skips unrelated heavy checks such as Java legacy office conversion and
    Dockerfile lint when the affected file set does not touch those surfaces.
  - Not a replacement for CI / release full `pnpm repo:static`.
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
- `pnpm --dir apps/campus-web test:e2e`
  - Campus-web local browser E2E lane through Playwright Test.
  - Uses the local Cloudflare Vite dev server and deterministic browser-side
    API mocks for product UI journeys.
  - Focuses on React shell user journeys; docs / Worker route boundary coverage
    belongs to `test:e2e:worker`.
- `pnpm --dir apps/campus-web test:e2e:worker`
  - Campus-web local Worker/docs browser E2E lane through Playwright Test.
  - Uses the local Cloudflare Vite dev server without browser-side API mocks.
  - Proves Worker-owned routes such as probes, docs redirects, missing docs
    fail-closed behavior, protected docs asset denial and unknown API paths.
  - Not a staging release proof and not part of the root web graph lane.
- `pnpm --dir apps/operator-console-web test`
  - Operator-console-web Worker lane.
- `cd apps/execution-control && go test ./...`
  - Go unit / integration lane using package tests and Temporal test
    environment where applicable.
- `cd apps/execution-control && go test -tags temporal_e2e ...`
  - Explicit Temporal dev-server / test-server lane. It is not part of the
    default Go lane.
- `pnpm --dir apps/app-api hindsight:memory:e2e:staging`
  - Explicit live Hindsight personal-memory lane through execution-control
    internal memory commands.
  - It verifies async append acceptance, operation status/materialization proof,
    operation list sanitized projection, recall, reflect, explicit profile memory
    commands, owner disable and user isolation against a self-hosted Hindsight
    runtime.
  - Unit mocks or offline fixtures must not be reported as this live lane.

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
