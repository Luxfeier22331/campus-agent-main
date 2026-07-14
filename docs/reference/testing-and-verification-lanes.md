---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-31
updated: 2026-07-13
---
# Testing And Verification Lanes

## Boundary

This document names the stable verification lanes and their meaning. It does not
replace architecture, app-local README commands, release runbooks or CI
configuration.

## CI Model

GitHub Actions keeps one automatic PR workflow:
`.github/workflows/pr.yml`.

- Workflow responsibility: event trigger, changed-surface routing, GitHub-native
  security actions and the stable `required` aggregate job.
- `dorny/paths-filter` is the only changed-surface classifier. Generic tools run
  directly in their jobs; domain and contract assertions run through owner
  package/app lanes. The TypeScript lane routes all files under Node owner
  directories instead of maintaining a source-extension allowlist; only each
  owner directory's root `README.md` is excluded.
- `changes` performs runner preflight, resolves the comparison base and emits
  every lane and image decision from that single classifier invocation.
- `static` always scans the pull-request commit range for secrets and runs the
  repository hygiene lane. It conditionally adds workflow, Python, YAML, SQL,
  Dockerfile, shell and dependency checks without repeating checkout or setup.
- `node` shares one pnpm workspace install across the conditional Contracts,
  affected TypeScript, Worker and Eval steps. `go`, `rust` and `infra` remain
  separate owner jobs; `image-scan` builds only changed runtime images after
  their source checks succeed.
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

GitHub Environments own deploy credential separation. `staging` is used by
`.github/workflows/deploy-staging.yml` after a successful PR merges to `main`.
The `staging` environment keeps only deploy credentials and deploy-time public
configuration: `CLOUDFLARE_API_TOKEN` as a secret, and
`CLOUDFLARE_ACCOUNT_ID`, `STAGING_CAMPUS_AUTH_TURNSTILE_SITE_KEY`,
`STAGING_ACCESS_TEAM_DOMAIN` and `STAGING_ACCESS_POLICY_AUD` as variables.
Execution-control staging upstream is a Worker VPC Service binding plus
Kubernetes `cloudflared` connector, so GitHub deploy does not carry an
execution-control public URL. Staging operator DB credentials and runtime
secrets belong to ops smoke / closeout, Cloudflare Worker secrets or K8s secret
delivery, not the GitHub staging deploy workflow. Production automation does
not exist until real deploy, approval and rollback behavior are explicitly
wired. Manual image publication and controlled release validation stay outside
ordinary PR blockers.
Ragas/Langfuse scoring is an internal eval shell/runtime lane, not a GitHub
Actions workflow.

First-party K8s images are published with the source commit SHA and selected in
the environment repository by multi-architecture manifest digest. Mutable
staging tags and node-local image cache state are not deployment inputs.

K8s/GitOps deployment validation is gated by live infrastructure bootstrap.
Do not treat source-repository bases as deployed truth. Claim deployment
validation only when the environment repository revision, Argo CD, the selected
secret backend, KEDA and all target Applications report healthy state in the
cluster. For execution-runtime promotion, the environment repository also
requires public `app-api /readyz` to report the release identifier selected by
its desired state.

## Scheduled Full Health Checks

`.github/workflows/scheduled-health.yml` runs full non-release health checks on
a weekly schedule and through manual dispatch. It is for drift / regression
detection after PR-level affected checks have kept ordinary feedback cheap.

- It runs `pnpm ci:repo`, `pnpm ci:typescript:full`, `pnpm ci:contracts`,
  `pnpm ci:eval`, `pnpm ci:go`, `pnpm ci:rust` and the local OSV-Scanner
  dependency job.
- Repository, Contracts, TypeScript and Eval checks share one serial Node job
  and one dependency installation. Go, Rust and dependency scanning retain
  separate owner jobs.
- It must not define `pull_request` triggers or participate in
  `pr / required`.
- It may use explicitly allowed CI infrastructure credentials, such as Turbo
  Remote Cache variables on Turbo jobs. It must not use deploy, provider,
  database, object-store, eval publishing or release credentials.
- It is not a PR blocker, release closeout, deployment validation, eval scoring
  lane or image publishing lane.

## CI Cache And Resource Policy

- Turbo is the only task-result cache for JS/TS typecheck, unit-test, Worker
  test and hermetic Worker build tasks. Package-external files read by a task
  must be declared in that task's Turbo inputs, including root configuration
  files and workspace package sources read from owner tests or builds.
- Remote Turbo artifacts are HMAC signed. Trusted CI supplies a random
  `TURBO_REMOTE_CACHE_SIGNATURE_KEY` of at least 32 bytes together with its
  cache token; neither secret may be exposed to fork pull requests. Missing
  remote-cache credentials must degrade to local execution, not fail a public
  contribution.
- Self-hosted CI runs Turbo with concurrency `1` and reuses persistent pnpm,
  Go, uv, Cargo, BuildKit and Trivy caches without uploading language caches to
  GitHub Actions. GitHub-hosted runners may use Actions dependency caches.
- TypeScript jobs publish `scripts/ci/turbo-summary.sh` output to the GitHub job
  summary so cache hits and executed tasks over 30 seconds remain visible.
- Large Vitest owners stay at one worker. Files proven safe to share one module
  environment use non-isolated configs; files with process-global mocks or
  mutable module state use the `*.isolated.test.*` convention and a separate
  config. Never disable isolation for an entire owner without running both
  groups and proving that file-order changes cannot leak mocks.
- Cloudflare Workers Vitest projects also set `fileParallelism: false` and
  `maxWorkers: 1`. Turbo concurrency limits package tasks, not the number of
  `workerd` processes that the Workers pool starts for test files.
- Dependency and image vulnerability scans, integration tests and staging or
  release checks never reuse a cached success result.
- Do not cache or upload `node_modules`.
- The current private-repository self-hosted runner is trusted infrastructure.
  Before accepting public pull requests, move PR and scheduled checks to
  GitHub-hosted runners; never execute untrusted fork code on the cluster host.

## Security / Supply Chain Lanes

- Secret scanning:
  - PR CI uses the pinned multi-architecture Gitleaks CLI image in the
    `static` job and scans the PR commit range.
  - `pre-commit` also runs the Gitleaks staged-file hook for local hygiene.
  - It does not replace GitHub Secret Protection or historical leak response.
- Dependency vulnerability scanning:
  - PR and scheduled CI run `pnpm ci:deps` in explicit lockfile mode for the
    pnpm, uv, Cargo and Go dependency graphs.
  - Any vulnerability exception must live in `osv-scanner.toml` with advisory
    id, reason and `ignoreUntil`; do not hide exceptions in workflow logic.
  - Root pnpm override rationale and removal conditions live in
    `docs/reference/dependency-overrides.md`.
  - Dependabot PRs should record the dependency lane result in the PR.
- Workflow security:
  - `pnpm ci:config` directly runs actionlint and zizmor.
  - Every external GitHub Action is pinned to a full commit SHA and every CI
    tool container is pinned to a multi-architecture manifest digest. Keep the
    readable release version in the adjacent comment or image tag.
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
  - Gitleaks PR commit-range scan in the `static` job.
  - `pr / required`.
- Conditional PR blockers from changed-surface detection:
  - actionlint and zizmor for `.github/**`.
  - Ruff/uv, yamllint, SQLFluff, Hadolint, ShellCheck and Kustomize/Conftest for
    their matching file surfaces.
  - `pnpm ci:typescript`.
  - `pnpm ci:worker`.
  - `pnpm ci:contracts`.
  - `pnpm ci:go`.
  - `pnpm ci:rust`.
  - `pnpm ci:eval`.
  - OSV-Scanner dependency scan for dependency manifests, lockfiles and Go
    module files.
  - Native image build and Trivy scan for affected first-party runtime images.

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
  - PR and scheduled CI run the same command on their selected runner.
- `pnpm ci:worker`
  - Worker owner tests, Worker runtime tests and hermetic Worker/app build smoke
    for app-api, campus-web and operator-console-web.
  - Uses Turbo-owned Wrangler dry-run for app-api and app-local build tasks for
    browser Worker shells; declared build outputs may be restored from signed
    remote cache artifacts.
  - Does not run `campus-web build:docs`, staging deploy, production deploy or
    browser E2E.
- `pnpm web:typecheck`, `pnpm web:test`, `pnpm ci:typescript:full`
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

- `pnpm ci:typescript`
  - The only affected JS/TS typecheck / unit-test lane for app, package and job
    code. Turbo owns task selection, dependency ordering and result caching.
- `pnpm ci:worker`
  - Worker runtime test and Worker/app build lane for app-api, campus-web,
    operator-console-web and runtime config changes.
- `pnpm ci:contracts`
  - Contract schema generation and canonical JSON Schema/OpenAPI checks.
    TypeScript contract tests run once in `pnpm ci:typescript`.
- `pnpm ci:go`
  - Execution-control Go static checks and tests.
- `pnpm ci:rust`
  - Rust ingestion kernel formatting, Clippy checks and tests.
- `pnpm ci:eval`
  - Eval-langfuse audit and isolated Ragas runner tests. Eval and app-api
    TypeScript tests run once in `pnpm ci:typescript`.
- OSV-Scanner dependency job
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
| Execution-control Go code, Go module / lint config, query-serving `serving-config.json` or a runtime artifact read by execution-control | `pnpm ci:go`; add contract / Worker lanes when their inputs also change | Temporal dev-server / deployment smoke remains explicit, not automatic PR default. |
| `configs/runtime/` | `pnpm ci:contracts`, `pnpm ci:typescript` and `pnpm ci:worker`; add `pnpm ci:go` only for execution-control, query-serving scope, tool schema / registry or workflow artifact inputs | Do not route unrelated runtime configuration through Go checks. |
| `packages/eval-langfuse/`, `packages/ragas-runner/` or eval docs/contracts | `pnpm ci:eval` | Ragas/Langfuse scoring is executed by the internal eval shell/runtime, not by GitHub Actions. |
| ingestion contract package | `pnpm ci:contracts` plus `pnpm ci:typescript` | Release / alias publish closeout stays in the owning ingestion runbook. |
| ingestion apps, source collectors, ingest-core or configs | `pnpm ci:typescript` | Release / alias publish closeout stays in the owning ingestion runbook. |
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
- `pr / image-scan`
  - Builds and scans only affected `execution-control`, `agent-runtime`,
    `app-api-schema`, `ops-web` and `transport-publisher` images.
  - The trusted self-hosted path reuses one disk-bounded BuildKit builder and a
    persistent Trivy database, then removes loaded PR image tags after scanning.
  - It is included in `pr / required`.
- `.github/workflows/execution-runtime-publish.yml`
  - A `main` push publishes only affected multi-architecture SHA candidates;
    manual dispatch publishes all managed candidates.
  - BuildKit attaches an OCI SBOM, then Trivy scans both amd64 and arm64 by
    manifest digest. GitOps promotion starts only after every scan passes.
  - The environment pull request updates only image entries that already exist
    in GitOps and source refs only when Kubernetes bases changed. A changed K8s
    source ref, `execution-control` image or `agent-runtime` image must match at
    least one GitOps consumer; zero matches fail promotion.
- `.github/workflows/scorecard.yml`
  - Scheduled / manual OpenSSF Scorecard security posture signal.
  - It is not a PR blocker and must not be treated as branch protection
    replacement while the repository cannot enforce rulesets.
- `.github/workflows/scheduled-health.yml`
  - Scheduled / manual full repository health check.
  - It is not a PR blocker and does not replace staging release closeout.
- `.github/workflows/deploy-staging.yml`
  - Automatic staging deployment after a successful PR merges to `main`, and
    manual dispatch for a selected ref.
  - It deploys and checks only affected app-api, campus-web or operator console
    surfaces. It does not check execution runtime readiness before the GitOps
    promotion is merged.
  - Its GitHub secret surface is limited to Cloudflare deploy auth. App-api
    staging reaches execution-control through the committed
    `EXECUTION_CONTROL_PRIVATE` VPC Service binding and non-secret
    `EXECUTION_CONTROL_PRIVATE_ORIGIN`; staging DB credentials stay in smoke /
    closeout paths.
  - Full staging validation is completed by the environment repository after
    promotion; this source workflow is not a PR blocker.

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
