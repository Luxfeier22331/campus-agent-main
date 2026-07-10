---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-31
updated: 2026-07-10
---
# Testing And Verification Lanes

## Boundary

This document names the stable verification lanes and their meaning. It does not
replace architecture, app-local README commands, release runbooks or CI
configuration.

## CI Model

GitHub Actions keeps one automatic PR / main workflow:
`.github/workflows/pr.yml`.

- Workflow responsibility: event trigger, changed-surface routing, GitHub-native
  security actions and the stable `required` aggregate job.
- `dorny/paths-filter` is the only changed-surface classifier. Generic tools run
  directly in their jobs; domain and contract assertions run through owner
  package/app lanes.
- Branch protection should require `pr / required`, not every conditional job
  name. Conditional jobs may be skipped when their surface is untouched.
- Repository rulesets should protect `main` with pull requests,
  up-to-date branches, no force-push / deletion and the single required status
  check `pr / required`.
- When the private repository plan cannot enable branch protection / rulesets,
  the same rule is enforced manually: do not merge to `main` until
  `pr / required` is success.
- Skipped conditional jobs are acceptable only when changed-surface detection
  correctly marks the untouched surface as out of scope.

GitHub Environments own deploy credential separation. `staging` may be used by
`.github/workflows/deploy-staging.yml` after successful `pr` on `main`.
The `staging` environment keeps only deploy credentials and deploy-time public
configuration: `CLOUDFLARE_API_TOKEN` as a secret, and
`CLOUDFLARE_ACCOUNT_ID`, `STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY`,
`STAGING_ACCESS_TEAM_DOMAIN` and `STAGING_ACCESS_POLICY_AUD` as variables.
Execution-control staging upstream is a Worker VPC Service binding plus
Kubernetes `cloudflared` connector, so GitHub deploy does not carry an
execution-control public URL. Staging operator DB credentials and runtime
secrets belong to ops smoke / closeout, Cloudflare Worker secrets or K8s secret
delivery, not the GitHub staging deploy workflow. `production` is used only by
`.github/workflows/production-preflight.yml` until real production deploy
scripts and rollback are explicitly wired. Manual image build / push and
controlled release validation stay outside ordinary PR blockers.
Ragas/Langfuse scoring is an internal eval shell/runtime lane, not a GitHub
Actions workflow.

Mutable K8s staging image tags must have an owning image workflow and
`imagePullPolicy: Always` in the matching staging manifests. A GitOps sync must
not rely on a node-local cached `:staging` image after runtime config, binary or
schema files change.

K8s/GitOps deployment validation is gated by live infrastructure bootstrap.
Do not treat `infra/gitops/apps/*.yaml` as deployed truth, and do not claim
nc-arm-6c deploy validation until Argo CD, the selected secret backend, KEDA
and the target Applications exist and report healthy state in the cluster.

## Scheduled Full Health Checks

`.github/workflows/scheduled-health.yml` runs full non-release health checks on
a weekly schedule and through manual dispatch. It is for drift / regression
detection after PR-level affected checks have kept ordinary feedback cheap.

- It runs `pnpm ci:repo`, `pnpm ci:web:full`, `pnpm ci:contracts`,
  `pnpm ci:ingest`, `pnpm ci:eval`, `pnpm ci:go`, `pnpm ci:rust` and the
  OSV-Scanner reusable workflow.
- It must not define `pull_request` triggers or participate in
  `pr / required`.
- It may use explicitly allowed CI infrastructure credentials, such as Turbo
  Remote Cache variables on Turbo jobs. It must not use deploy, provider,
  database, object-store, eval publishing or release credentials.
- It is not a PR blocker, release closeout, deployment validation, eval scoring
  lane or image publishing lane.

## Security / Supply Chain Lanes

- Secret scanning:
  - PR CI uses `gitleaks/gitleaks-action@v3` in the `secrets` job.
  - Organization/private operation requires `GITLEAKS_LICENSE` in GitHub
    Secrets until repository ownership / visibility no longer requires it.
  - `pre-commit` also runs the Gitleaks staged-file hook for local hygiene.
  - It does not replace GitHub Secret Protection or historical leak response.
- Dependency vulnerability scanning:
  - PR and scheduled CI use the Google OSV-Scanner reusable workflows in
    explicit lockfile mode for the pnpm, uv, Cargo and Go dependency graphs.
  - `pnpm ci:deps` is the local CLI equivalent for manual verification.
  - Any vulnerability exception must live in `osv-scanner.toml` with advisory
    id, reason and `ignoreUntil`; do not hide exceptions in workflow logic.
  - Root pnpm override rationale and removal conditions live in
    `docs/reference/dependency-overrides.md`.
  - Dependabot PRs should record the dependency lane result in the PR.
- Workflow security:
  - `pnpm ci:config` directly runs actionlint and zizmor.
  - The repo does not maintain a second workflow topology, action allowlist or
    semantic fixture framework.
- CodeQL / Dependency Review / artifact attestations:
  - Enable GitHub-native features when the repository plan supports GitHub Code Security / Advanced Security.
  - Do not add them as ordinary PR blockers until the prerequisite and release
    artifact surface are confirmed.
  - SBOM / provenance applies to real release artifacts, not ordinary PR checks.

## PR Blocker Lanes

- Always-on PR blockers:
  - `pnpm ci:repo`.
  - `gitleaks/gitleaks-action@v3` in the `secrets` job.
  - `pr / required`.
- Conditional PR blockers from changed-surface detection:
  - actionlint and zizmor for `.github/**`.
  - Ruff/uv, yamllint, SQLFluff, Hadolint, ShellCheck and Kustomize/Conftest for
    their matching file surfaces.
  - `pnpm ci:web`.
  - `pnpm ci:worker`.
  - `pnpm ci:contracts`.
  - `pnpm ci:go`.
  - `pnpm ci:rust`.
  - `pnpm ci:eval`.
  - `pnpm ci:ingest`.
  - OSV-Scanner dependency scan for dependency manifests, lockfiles and Go
    module files.

## Repo Lanes

- `pre-commit`
  - Local developer hygiene hook for lightweight file checks such as large
    files, merge conflicts, JSON / TOML / YAML parseability, EOF and trailing
    whitespace, plus staged secret scanning through Gitleaks.
  - It is the only repository-level local hook system. Do not add Husky,
    lint-staged, lefthook or root `prepare` hooks unless a separate governance
    decision replaces this policy.
  - Not a typecheck, unit test, build, runtime smoke, CI replacement or release
    closeout.
- `pnpm repo:static`
  - Direct Biome, Markdownlint and EditorConfig Checker aggregate for generic
    formatting and text hygiene.
  - It contains no architecture allowlist, changed-path router or domain policy.
  - Not a typecheck, unit test, integration test or E2E validation.
- `pnpm ci:repo`
  - CI alias for `pnpm repo:static`.
- `pnpm ci:config`
  - CI workflow and action security lint through actionlint and zizmor.
  - It proves automation shape, not business runtime behavior.
- `pnpm ci:deps`
  - Local OSV-Scanner scan over the pnpm, uv, Cargo and Go dependency graphs.
  - CI uses the OSV-Scanner reusable workflows rather than a repo-owned wrapper.
- `pnpm ci:worker`
  - Worker owner tests, Worker runtime tests and hermetic Worker/app build smoke
    for app-api, campus-web and operator-console-web.
  - Uses Wrangler dry-run for app-api and app-local build scripts for browser
    Worker shells.
  - Does not run `campus-web build:docs`, staging deploy, production deploy or
    browser E2E.
- `pnpm web:typecheck`, `pnpm web:test`, `pnpm ci:web:full`
  - JS/TS stable graph checks.
  - `pnpm web:test` is the stable default lane, not all Worker / integration
    tests.
- `pnpm web:build`
  - Full JS/TS build lane.
  - It is not a hermetic public-clone PR blocker because `campus-web`
    `build:docs` needs an existing public docs sync manifest or access to the
    app-api operator database through `APP_API_OPERATOR_DATABASE_URL`.
- `pnpm web:test:worker`
  - Explicit Worker runtime lane for app-api, campus-web and
    operator-console-web.
- `pnpm web:test:integration`
  - Explicit external dependency integration lane; currently app-api shared DB
    integration.

## Conditional CI Lanes

- `pnpm ci:web`
  - Affected JS/TS typecheck / test lane for app, package and job code.
- `pnpm ci:worker`
  - Worker runtime test and Worker/app build lane for app-api, campus-web,
    operator-console-web and runtime config changes.
- `pnpm ci:contracts`
  - `packages/contracts` TS typecheck / Vitest contract tests, contract schema
    generation/checks and a thin Python adapter smoke suite.
- `pnpm ci:go`
  - Execution-control Go static checks and tests.
- `pnpm ci:rust`
  - Rust ingestion kernel formatting, Clippy checks and tests.
- `pnpm ci:eval`
  - Eval-langfuse typecheck/test/audit, isolated Ragas runner tests and app-api
    Langfuse trace-id vector check.
- `pnpm ci:ingest`
  - `packages/ingestion-contracts` and `packages/ingest-core` typecheck/tests,
    repository registry executability and the thin Python adapter smoke suite.
- OSV-Scanner reusable workflow
  - Dependency vulnerability lane for dependency manifests, lockfiles and Go
    module files.

## PR Verification Decision Table

| Changed surface | PR lane | Extra lane decision |
| --- | --- | --- |
| `.github/**` | actionlint, zizmor, yamllint and `pnpm ci:repo` | If a workflow can publish artifacts or use secrets, confirm trigger, environment and permission boundaries in review. |
| Root npm / pnpm workspace files or `pnpm-lock.yaml` | all Node owner lanes and OSV-Scanner dependency scan | Root dependency graph changes can affect every workspace package. Do not use full `pnpm web:build` as a generic PR blocker while docs manifest / operator DB env is not hermetic. |
| Package-local `package.json` | owning surface lane, affected JS/TS lane and OSV-Scanner dependency scan | A local manifest must not fan out to unrelated Contracts, Worker, Eval or Ingest lanes. |
| Root Python workspace files or `uv.lock` | Python and all Python-backed owner lanes plus OSV-Scanner dependency scan | Root dependency graph changes can affect every uv workspace package. |
| Package-local `pyproject.toml` | Python, owning surface lane and OSV-Scanner dependency scan | A local manifest must not fan out to unrelated Python-backed owner lanes. |
| `apps/execution-control/` or runtime tool config | `pnpm ci:go` plus contract / Worker lanes when runtime config changes | Temporal dev-server / deployment smoke remains explicit, not automatic PR default. |
| `configs/runtime/` | `pnpm ci:contracts`, `pnpm ci:go` and `pnpm ci:worker` | Treat runtime config as model-visible / runtime-facing until proven otherwise. |
| `packages/eval-langfuse/`, `packages/ragas-runner/` or eval docs/contracts | `pnpm ci:eval` | Ragas/Langfuse scoring is executed by the internal eval shell/runtime, not by GitHub Actions. |
| ingestion contract package | `pnpm ci:ingest` plus `pnpm ci:web` when TS package code changes | Release / alias publish closeout stays in the owning ingestion runbook. |
| ingestion apps, source collectors, ingest-core or configs | `pnpm ci:ingest`, plus `pnpm ci:web` for TS workspace code | Release / alias publish closeout stays in the owning ingestion runbook. |
| Rust ingestion kernels or Cargo workspace files | `pnpm ci:rust` | Run OSV-Scanner as well when Cargo manifests or the lockfile change. |
| release image / deploy / deployment validation | owning PR lane plus explicit manual / environment lane record | Artifact attestation / SBOM / SLSA only apply to real release artifacts after the required GitHub feature is available. |

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
  - Not staging release closeout and not part of the root web graph lane.
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
  - Execution-control deployment smoke.
- `docs/runbooks/worker-observability-smoke.md`
  - Forward Worker observability preflight / post-deploy smoke.
- `docs/runbooks/eval-ragas.md`
  - Internal Ragas/Langfuse scoring shell/runtime procedure. It may publish
    Langfuse scores only through configured internal eval credentials.
- `.github/workflows/dining-sync-image.yml`
  - Manual dining-sync image build / optional GHCR push workflow.
  - It builds a local image, blocks on Trivy HIGH / CRITICAL findings, and
    generates an SBOM artifact when `push_image=true`.
- `.github/workflows/execution-runtime-image.yml`
  - Execution runtime image build and GHCR publish workflow for
    `execution-control:staging` and `agent-runtime:staging`.
  - Pull requests build and scan the images. Pushes to `main`, or manual
    dispatch with `push_image=true`, publish both `${{ github.sha }}` and
    `staging` tags and generate SBOM artifacts.
- `.github/workflows/scorecard.yml`
  - Scheduled / manual OpenSSF Scorecard security posture signal.
  - It is not a PR blocker and must not be treated as branch protection
    replacement while the repository cannot enforce rulesets.
- `.github/workflows/scheduled-health.yml`
  - Scheduled / manual full repository health check.
  - It is not a PR blocker and does not replace staging release closeout.
- `.github/workflows/deploy-staging.yml`
  - Automatic staging deployment after successful `pr` on `main`, and
    manual dispatch for a selected ref.
  - It binds the GitHub `staging` environment, runs existing app-local staging
    deploy scripts, then checks Worker `healthz` / `readyz`.
  - Its GitHub secret surface is limited to Cloudflare deploy auth. App-api
    staging reaches execution-control through the committed
    `EXECUTION_CONTROL_PRIVATE` VPC Service binding and non-secret
    `EXECUTION_CONTROL_PRIVATE_ORIGIN`; staging DB credentials stay in smoke /
    closeout paths.
  - It is deployment validation, not a PR blocker.
- `.github/workflows/production-preflight.yml`
  - Protected production release preflight through manual dispatch and the
    GitHub `production` environment.
  - It verifies the selected ref is on `main` history and runs Worker build
    preflight. It does not deploy production until production app deploy scripts
    and rollback are explicitly added.
  - It does not validate nc-arm-6c Kubernetes deployment. K8s deployment
    validation starts only after the GitOps bootstrap prerequisites are live.

## Rules

- Run the smallest lane that proves the changed surface, then broader repo gates
  when the change crosses boundaries.
- Dependabot PRs use their dependency ecosystem as the verification surface.
  `dorny/paths-filter` selects the affected Node, Python, Go or Rust owner lanes;
  dependency changes also run OSV-Scanner.
- Python tests are valid only for admitted Python adapters/islands. Repository
  policy is not implemented as a central test framework.
- Routine Dependabot version updates are limited to grouped minor / patch
  updates. Major dependency upgrades require an explicit human-owned branch and
  migration / verification plan.
- CodeQL, Dependency Review and artifact attestations require an explicit
  security / supply-chain lane decision before they become PR or release
  requirements.
- Do not treat release-closeout artifacts as main-chain architecture completion.
- Do not treat static/lint success as runtime correctness.
- Do not mix integration lanes into the default stable gate unless the changed
  surface requires external dependency validation.
- Record exact commands in PRs and final handoff; do not write "should pass".
- Prefer root `ci:*` scripts for local verification behavior. Prefer mature
  GitHub Actions or reusable workflows for platform-native security and routing
  behavior.
