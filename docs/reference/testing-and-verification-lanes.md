---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-03-31
updated: 2026-07-03
---
# Testing And Verification Lanes

## Boundary

This document names the stable verification lanes and their meaning. It does not
replace architecture, app-local README commands, release runbooks or CI
configuration.

## CI Model

GitHub Actions keeps one automatic PR / develop / main workflow:
`.github/workflows/pr-checks.yml`.

- Workflow responsibility: event trigger, changed-surface detection and the
  stable `required-checks` aggregate job.
- Script responsibility: all verification behavior lives behind root
  `package.json` `ci:*` lanes and must be locally reproducible.
- Branch protection should require `pr-checks / required-checks`, not every
  conditional job name. Conditional jobs may be skipped when their surface is
  untouched.
- When the private repository plan cannot enable branch protection / rulesets,
  the same rule is enforced manually: do not merge to `develop` until
  `pr-checks / required-checks` is success.
- Skipped conditional jobs are acceptable only when changed-surface detection
  correctly marks the untouched surface as out of scope.

Manual workflows remain separate for eval scoring, image build / push and
controlled release proof. They must not become ordinary PR blockers.

## Scheduled Full Health Checks

`.github/workflows/scheduled-checks.yml` runs full non-release health checks on
a weekly schedule and through manual dispatch. It is for drift / regression
detection after PR-level affected checks have kept ordinary feedback cheap.

- It runs `pnpm ci:repo-static`, `pnpm ci:web-graph:full`,
  `uv run --all-packages python -m unittest discover -s tests -t .`,
  `pnpm ci:go` and `pnpm ci:deps:vuln`.
- It must not define `pull_request` triggers, reference secrets or participate
  in `pr-checks / required-checks`.
- It is not a PR blocker, release proof, staging proof, eval scoring lane or
  image publishing lane.

## Security / Supply Chain Lanes

CodeQL / code scanning, Dependency Review and artifact attestations are security
and supply-chain lanes with GitHub plan / repository setting prerequisites for
private repositories. Do not add them as ordinary PR blockers until the required
GitHub security features are confirmed for this repository.

- Secret scanning:
  - `pnpm ci:secrets` runs Gitleaks against the current repository tree and is
    part of `pr-checks / required-checks`.
  - `pre-commit` also runs the Gitleaks staged-file hook for local hygiene.
  - It does not replace GitHub Secret Protection when that feature becomes
    available.
- Dependency vulnerability scanning:
  - `pnpm ci:deps:vuln` runs OSV-Scanner against root `pnpm-lock.yaml` and
    `uv.lock`.
  - It is scheduled / manual by default, not an ordinary PR blocker.
  - Dependabot or dependency-risk PRs may run it explicitly and record the
    result in the PR.
- Workflow security:
  - `pnpm ci:config:lint` includes actionlint, repo-owned workflow contract
    checks and workflow action policy checks.
  - Trusted version-tagged actions are allowlisted; new untrusted actions must
    use a full commit SHA or be added to the policy with a reason.
- CodeQL / code scanning:
  - Private repositories require GitHub Code Security / Advanced Security before
    code scanning can be enabled.
  - Prefer GitHub default setup after the feature is available. Add an advanced
    workflow only when this monorepo needs explicit build or language control.
  - It is not represented by a repo-owned workflow until the prerequisite is
    confirmed.
- Dependency Review:
  - The action is available for public repositories and for private repositories
    with GitHub Code Security / Advanced Security enabled.
  - Until that prerequisite is confirmed, Dependabot PRs use their dependency
    surface plus the documented verification commands as the enforceable rule.
  - After enablement, make it a dependency-change PR blocker, not a universal
    PR blocker.
- Artifact attestations / SBOM / SLSA:
  - Use only for real release artifacts, such as pushed container images or
    release bundles.
  - Do not generate provenance for ordinary PR checks, repo static checks,
    scheduled health checks or workflows that do not publish a release artifact.
  - For private / internal repositories, confirm the required GitHub plan before
    adding attestation steps.

## PR Blocker Lanes

- Always-on PR blockers:
  - `pnpm ci:repo-guard`
  - `pnpm ci:repo-static:affected` on pull requests
  - `pnpm ci:config:lint`
  - `pnpm ci:secrets`
  - `pr-checks / required-checks`
- Push-to-`develop` / `main` full static blocker:
  - `pnpm ci:repo-static`
- Conditional PR blockers from changed-surface detection:
  - `pnpm ci:web-graph:affected`
  - `pnpm ci:worker-runtime`
  - `pnpm ci:contracts`
  - `pnpm ci:go`
  - `pnpm ci:langfuse`
  - `pnpm ci:ingestion`

## Repo Lanes

- `pre-commit`
  - Local developer hygiene hook for lightweight file checks such as large
    files, merge conflicts, JSON / TOML / YAML parseability, EOF and trailing
    whitespace, plus staged secret scanning through Gitleaks.
  - It is the only repository-level local hook system. Do not add Husky,
    lint-staged, lefthook or root `prepare` hooks unless a future governance
    decision replaces this policy.
  - Not a typecheck, unit test, build, runtime smoke, CI replacement or release
    proof.
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
- `pnpm ci:repo-static:affected`
  - CI wrapper for PR affected static checks.
- `pnpm ci:config:lint`
  - CI workflow / lane contract check through actionlint, repo-owned workflow
    contract checks and workflow action policy checks.
  - It proves automation shape, not business runtime behavior.
- `pnpm ci:secrets`
  - Gitleaks current-tree secret scan.
  - Requires the `gitleaks` CLI locally; the wrapper fails closed with the
    pinned install command when the CLI is missing, and CI installs Gitleaks
    before calling the script.
  - Not a full historical secret audit and not a replacement for GitHub Secret
    Protection.
- `pnpm ci:deps:vuln`
  - OSV-Scanner dependency vulnerability scan over root `pnpm-lock.yaml` and
    `uv.lock`.
  - Runs in scheduled checks and may be used for Dependabot / dependency-risk
    PRs.
  - Requires the `osv-scanner` CLI locally; the wrapper fails closed with the
    pinned install command when the CLI is missing.
- `uv run --all-packages python -m unittest discover -s tests -t .`
  - Repo Python baseline through `uv` / `unittest`.
- `pnpm web:typecheck`, `pnpm web:test`, `pnpm ci:web-graph:full`
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

- `pnpm ci:web-graph:affected`
  - Affected JS/TS typecheck / test lane for app, package and job code.
  - Used by PR CI when changed-surface detection marks `web_graph=true`.
- `pnpm ci:worker-runtime`
  - Worker runtime test lane for app-api, campus-web and operator-console-web.
  - Used by PR CI when Worker app or runtime config files change.
- `pnpm ci:contracts`
  - Contract schema generation/checks plus contract unittest suite.
  - Used by PR CI when contracts, runtime schemas or contract tests change.
- `pnpm ci:go`
  - Execution-control Go static checks and tests.
  - Used by PR CI when execution-control or runtime tool config changes.
- `pnpm ci:langfuse`
  - Eval-langfuse typecheck/test plus app-api Langfuse trace-id vector check.
  - Used by PR CI when Langfuse, Ragas runner, telemetry or eval docs/contracts
    change.
- `pnpm ci:ingestion`
  - Ingestion/data-plane Python unittest lane.
  - Used by PR CI when ingestion apps, packages or ingestion tests change.

## PR Verification Decision Table

| Changed surface | PR lane | Extra lane decision |
| --- | --- | --- |
| `.github/workflows/pr-checks.yml`, root package / turbo config or CI scripts | all conditional PR lanes through changed-surface detection | Run `pnpm ci:config:lint`; do not add new automatic workflows without updating this document. |
| Other manual workflow files | `pnpm ci:config:lint` and `pnpm ci:repo-static:affected` | If the workflow can publish artifacts or use secrets, confirm manual-only triggers and environment / input guards. |
| npm / pnpm workspace dependency files | `pnpm ci:web-graph:affected` | Dependabot PRs use the dependency surface rule above; run `pnpm ci:deps:vuln` for dependency-risk changes. Run `pnpm web:build` only when the docs manifest / operator DB env is available. Dependency Review waits for GitHub security feature enablement. |
| `apps/execution-control/` or runtime tool config | `pnpm ci:go` plus contract / Worker lanes when runtime config changes | Temporal dev-server / staging smoke remains explicit, not automatic PR default. |
| `configs/runtime/` | `pnpm ci:contracts`, `pnpm ci:go` and `pnpm ci:worker-runtime` | Treat runtime config as model-visible / runtime-facing until proven otherwise. |
| `packages/eval-langfuse/`, `packages/ragas-runner/` or eval docs/contracts | `pnpm ci:langfuse` | Manual Ragas scoring remains `.github/workflows/eval-ragas-score.yml`. |
| ingestion apps/packages/kernels | `pnpm ci:ingestion` plus web graph when TS workspace code changes | Release / alias publish proof stays in the owning ingestion runbook. |
| release image / deploy / staging proof | owning PR lane plus explicit manual / staging lane record | Artifact attestation / SBOM / SLSA only apply to real release artifacts after the required GitHub feature is available. |

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
- `.github/workflows/eval-ragas-score.yml`
  - Manual Ragas scoring workflow. It may publish Langfuse scores only through
    protected eval environment inputs.
- `.github/workflows/dining-sync-image.yml`
  - Manual dining-sync image build / optional GHCR push workflow.
  - It builds a local image, blocks on Trivy HIGH / CRITICAL findings, and
    generates an SBOM artifact when `push_image=true`.
- `.github/workflows/public-docs-rolling-publish.yml`
  - Manual campus docs build-only workflow. It must not deploy.
- `.github/workflows/scorecard.yml`
  - Scheduled / manual OpenSSF Scorecard security posture signal.
  - It is not a PR blocker and must not be treated as branch protection
    replacement while the repository cannot enforce rulesets.
- `.github/workflows/scheduled-checks.yml`
  - Scheduled / manual full repository health check.
  - It is not a PR blocker and does not replace staging release proof.

## Rules

- Run the smallest lane that proves the changed surface, then broader repo gates
  when the change crosses boundaries.
- Dependabot PRs must use their dependency surface as the verification surface:
  GitHub Actions dependency updates run `pnpm ci:config:lint`, npm / pnpm
  workspace updates run `pnpm ci:web-graph:affected`, and Go module updates run
  `pnpm ci:go`. Run `pnpm ci:deps:vuln` when dependency risk is material.
- CodeQL, Dependency Review and artifact attestations require an explicit
  security / supply-chain lane decision before they become PR or release
  requirements.
- Do not treat release evidence as main-chain architecture completion.
- Do not treat static/lint success as runtime correctness.
- Do not mix integration lanes into the default stable gate unless the changed
  surface requires external dependency proof.
- Record exact commands in PRs and final handoff; do not write "should pass".
- Do not add CI behavior directly in workflow YAML when a root `ci:*` script can
  own it. Workflow YAML should route; scripts should verify.
