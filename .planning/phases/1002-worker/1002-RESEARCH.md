# Phase 1002: Worker 部署与发布硬化收口 - Research

**Researched:** 2026-04-14
**Domain:** Cloudflare Workers staging deploy hardening, release identity, Access/operator admission, shared DB freshness gates, and post-deploy observability closure
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Phase Boundary

本 phase 只处理当前 accepted Worker product surfaces 的 release-hardening closeout：

- `apps/app-api`
- `apps/public-chat-web`
- `apps/protected-panel-web`

目标是把 staging baseline、deploy-time release identity、config/secret gate、DB freshness gate、Access/operator admission、post-deploy observability evidence 收口成可执行的 release discipline。

本 phase 不处理：

- `authenticated_notice` live portal scheduling 或 control-plane rollout
- `official_web` collector live seam 的独立验收
- production hostname 切换
- `apps/supervisor-api` 的 repo-level runtime 冻结

### Locked Decisions

### Release hardening is a repo-level runtime concern

- `public-chat-web`、`protected-panel-web`、`app-api` 必须共享统一的 release-hardening contract，但继续保持独立 deploy unit。
- staging baseline 固定为 `campus-api-staging.ayafeed.com`、`campus-chat-staging.ayafeed.com`、`campus-panel-staging.ayafeed.com`；这不是临时 smoke 值，而是当前 repo-owned staging truth。

### Release identity must be deploy-time, not static config

- `SENTRY_RELEASE` 不得继续以历史静态值长期留在 repo config 中。
- release identity 必须在 deploy 时生成，并贯通 runtime env、observability 和 evidence artifact。
- 当前已知不对齐点是 `protected-panel-web` 已做 deploy-time release injection，而 `app-api` 与 `public-chat-web` 仍存在静态 release debt。

### Deploy gate must cover data freshness and operator admission

- `APP_API_DB` / `APP_API_DB_FRESH` 双 lane 继续保留；auth/read-after-write-sensitive path 必须走 fresh lane。
- shared Postgres drift reconciliation / migration 是 deploy gate，不是事故后排障动作。
- Access placeholder、operator allowlist miss、stale auth lookup 都属于 release-hardening miss。

### Closure requires post-deploy evidence

- `/readyz = 200` 不是 deploy closeout。
- release closeout 至少需要 `public-chat-web -> app-api` trace、`protected-panel-web -> app-api` trace、`app-api` runtime event evidence，以及按 release 收口的 artifact。

### Claude's Discretion

None provided in `1002-CONTEXT.md`.

### Deferred Ideas (OUT OF SCOPE)

- production release automation
- CI/CD provider-specific workflow design
- `official_web` live collector release with the same smoke lane
- `authenticated_notice` live control-plane rollout
</user_constraints>

## Summary

Phase 1002 is a release-hardening closeout phase, not a runtime-topology phase. The repo already has the right long-term staging shape: three Worker deploy units, fixed staging hostnames, Worker custom domains, `workers_dev = false`, service-binding based web shells, a dual-lane `APP_API_DB` / `APP_API_DB_FRESH` design, Cloudflare Access at the panel edge, and runbooks for staging deploy plus observability smoke. The main debt is that the release discipline is still uneven and partially manual.

The most important repo-specific gap is release identity. `protected-panel-web` already derives `SENTRY_RELEASE=protected-panel-web@staging-<sha>` at deploy time, but `apps/app-api/wrangler.toml` and `apps/public-chat-web/wrangler.toml` still freeze static `SENTRY_RELEASE` values in repo config, and their worker tests currently codify that debt. The second gap is gating: the repo already has `doctor_env.py`, `check_worker_secret_presence.py`, `verify-worker-deploy-config.mjs`, and staging drift commands, but the canonical staging deploy path still does not enforce one shared preflight contract that blocks deploy on missing shell env, bad binding config, or shared DB drift.

The phase should therefore implement one repo-owned staging hardening contract across the three Worker surfaces: deploy-time release identity for all three apps, mandatory preflight gates before publish, explicit proof that fresh-lane reads are preserved for auth-sensitive paths, explicit separation between Access failure and operator-admission failure, and release-scoped observability artifacts that prove real requests and runtime events hit the sinks after deploy.

**Primary recommendation:** Implement a single release-hardening contract across `app-api`, `public-chat-web`, and `protected-panel-web` centered on deploy-time `SENTRY_RELEASE`, mandatory staging preflight gates, explicit fresh-lane/operator-admission proof, and release-scoped post-deploy evidence; leave infrastructure provisioning and live operator/browser actions in runbooks.

## Implementation Scope

### Phase 1002 should implement

- Remove static `SENTRY_RELEASE` from [`apps/app-api/wrangler.toml`](/home/reptilian/code/campus-agent/apps/app-api/wrangler.toml) and [`apps/public-chat-web/wrangler.toml`](/home/reptilian/code/campus-agent/apps/public-chat-web/wrangler.toml).
- Make all three staging deploy paths inject `SENTRY_RELEASE` at deploy time using one naming rule, e.g. `<app>@staging-<shortsha>`, with optional explicit override via staging shell env.
- Update worker tests so `app-api` and `public-chat-web` assert absence of static `SENTRY_RELEASE` in Wrangler config and presence of deploy-time injection behavior, matching the already-correct panel pattern.
- Add one canonical staging preflight that fails before publish when required `STAGING_*` shell inputs are missing, Cloudflare secrets are missing, built Worker config is wrong, or staging shared DB drift is unresolved.
- Keep `db:reconcile-shared-drift:staging` as a hard gate in the canonical deploy path.
- Preserve and prove the `APP_API_DB` / `APP_API_DB_FRESH` split for auth-sensitive or read-after-write-sensitive flows; this phase should gate and verify the split, not redesign it.
- Harden docs/tests/error handling so Access protection failure, operator allowlist failure (`operator_identity_not_admitted`), and bridge/runtime failure are treated as distinct release-hardening outcomes.
- Make observability closure artifacts release-scoped by path and by document contents, including timestamp, environment, release, operator, trace IDs, and runtime event evidence.

### Keep runbook-only

- Cloudflare custom domain provisioning and DNS ownership steps.
- Cloudflare Access application creation, audience lookup, and dashboard-side policy edits.
- Hyperdrive resource provisioning and cache-disable resource setup.
- Choosing and operating the temporary upstream supervisor or tunnel used by staging smoke.
- Explicit execution of `db:migrate:staging`.
- Live browser smoke, screenshots, and operator session actions against real staging.
- CI/CD-provider-specific automation.
- Sentry deploy-record API integration; useful, but not a hard Phase 1002 gate.

### Hard acceptance criteria

- No static `SENTRY_RELEASE` remains in [`apps/app-api/wrangler.toml`](/home/reptilian/code/campus-agent/apps/app-api/wrangler.toml) or [`apps/public-chat-web/wrangler.toml`](/home/reptilian/code/campus-agent/apps/public-chat-web/wrangler.toml).
- All three staging deploy paths derive and inject release identity at deploy time, and that release reaches runtime env plus observability queries.
- The canonical staging preflight fails closed on any of:
  - missing `STAGING_SUPERVISOR_API_BASE_URL`
  - missing `STAGING_ACCESS_TEAM_DOMAIN`
  - missing `STAGING_ACCESS_POLICY_AUD`
  - missing required Worker secrets
  - wrong built service binding config
  - unresolved staging shared DB drift
- `APP_API_DB` and `APP_API_DB_FRESH` remain distinct in staging config, and staging auth smoke proves immediate fresh-read behavior on an auth-sensitive path.
- Panel staging is not considered closed out until the real hostname is behind Cloudflare Access and an admitted operator can hit at least one `/api/operator/*` path without `operator_identity_not_admitted`.
- Deploy closeout requires all of:
  - one `public-chat-web -> app-api` trace
  - one `protected-panel-web -> app-api` trace
  - one `app-api` runtime event such as `projection.drain` or equivalent runtime evidence
  - one release-scoped artifact directory on disk containing the closure summary
- `/readyz = 200` alone is insufficient.

### Main risks if current debt remains

- Static release IDs collapse distinct deploys into one Sentry release, which weakens regression attribution, source-map lookup, and postmortem clarity.
- Staging deploy can still publish successfully with missing or placeholder `STAGING_*` shell inputs because those values are modeled in repo but not yet universally enforced in the canonical deploy path.
- Shared Postgres drift can survive into a published Worker deploy and surface as staging control-plane or operator failures after release.
- Cached-lane reads can mask auth or allowlist changes, producing false staging confidence on operator-sensitive paths.
- Evidence directories without release identity stay ambiguous across repeated smokes and break release-audit reuse.
- Access envelope failures can be misclassified as operator-admission failures, or vice versa, wasting debugging time during cutover.

## Standard Stack

### Core

| Library / Tool | Repo Version | Verified Current | Purpose | Why Standard |
|---------|---------|---------|---------|--------------|
| `wrangler` | `^4.77.0` / `^4.78.0` | `4.82.2` published `2026-04-13` | Worker deploy, env routing, secret/config resolution | Official Cloudflare deploy tool; envs, routes, custom domains, and secret scope are defined here |
| `@sentry/cloudflare` | `^10.46.0` | `10.48.0` published `2026-04-09` | Worker-side Sentry release and environment tagging | Official Sentry SDK for Cloudflare Workers; release identity should be injected at build/deploy time |
| `jose` | `^6.0.10` | `6.2.2` published `2026-03-18` | Cloudflare Access JWT verification in Worker runtime | Official Cloudflare Access validation examples use `jose`; repo already uses it in panel runtime |
| `drizzle-kit` | `^0.31.5` | `0.31.10` published `2026-03-17` | Shared Postgres drift reconciliation and migrations | Existing repo migration/drift tool; Phase 1002 should gate around it rather than replace it |

### Supporting

| Tool | Location | Purpose | When to Use |
|---------|---------|---------|-------------|
| `doctor_env.py` | [`scripts/doctor_env.py`](/home/reptilian/code/campus-agent/scripts/doctor_env.py) | Checks required shell env for `worker-staging` and other surfaces | Run before any staging publish; make it part of the canonical preflight |
| `check_worker_secret_presence.py` | [`scripts/check_worker_secret_presence.py`](/home/reptilian/code/campus-agent/scripts/check_worker_secret_presence.py) | Audits Cloudflare Worker secrets against `wrangler.toml` declared requirements | Required in every staging deploy path |
| `verify-worker-deploy-config.mjs` | [`scripts/verify-worker-deploy-config.mjs`](/home/reptilian/code/campus-agent/scripts/verify-worker-deploy-config.mjs) | Verifies built Worker config contains expected service bindings | Required after build, before staging deploy |
| `run-with-staging-db-env.mjs` | [`apps/app-api/scripts/run-with-staging-db-env.mjs`](/home/reptilian/code/campus-agent/apps/app-api/scripts/run-with-staging-db-env.mjs) | Injects staging DB env for drift/migration commands | Use for staging drift and migration gates |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Deploy-time `SENTRY_RELEASE` injection | Static `SENTRY_RELEASE` in `wrangler.toml` | Static config is simpler but breaks per-deploy release identity and evidence linkage |
| Repo-owned preflight scripts | Manual dashboard/operator checklist | Manual checks miss shell env, config drift, and per-app consistency failures |
| Dual-lane Hyperdrive (`APP_API_DB` + `APP_API_DB_FRESH`) | One cached DB lane plus ad hoc busting | Ad hoc busting is weaker and less auditable for auth-sensitive reads |
| Cloudflare Access JWT validation with `jose` | Custom JWT parsing | Higher security risk and divergence from Cloudflare's documented verification flow |

**Installation:** None. Phase 1002 should reuse existing workspace dependencies and existing repo scripts; it does not require a new library.

**Version verification:** Verified against `npm view` on 2026-04-14 for `wrangler`, `@sentry/cloudflare`, `jose`, and `drizzle-kit`.

## Architecture Patterns

### Recommended Project Structure

```text
apps/
├── app-api/                    # shared backend Worker + staging DB gate scripts
├── public-chat-web/            # public Worker shell + APP_API service binding
└── protected-panel-web/        # Access-protected Worker shell + operator bridge

scripts/
├── doctor_env.py               # shell env readiness
├── check_worker_secret_presence.py
└── verify-worker-deploy-config.mjs

docs/runbooks/
├── staging-worker-deploy-runbook.md
└── worker-observability-smoke-runbook.md
```

### Pattern 1: Deploy-Time Release Identity Injection

**What:** Release identity is generated during the staging deploy command and injected via Worker vars, never frozen in repo config.

**When to use:** Every staging deploy for `app-api`, `public-chat-web`, and `protected-panel-web`.

**Repo-specific conclusion:** Reuse the existing `protected-panel-web` pattern and normalize it across all three Worker surfaces. Phase 1002 should not introduce a second release naming pattern.

**Example:**

```js
import { spawnSync } from "node:child_process";

function resolveRelease(appName) {
  const override = process.env.STAGING_SENTRY_RELEASE?.trim();
  if (override) return override;

  const sha = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).stdout.trim();

  return `${appName}@staging-${sha}`;
}

const release = resolveRelease("app-api");
spawnSync("wrangler", ["deploy", "--var", `SENTRY_RELEASE:${release}`], {
  stdio: "inherit",
});
```

Source: Sentry Cloudflare release configuration docs and the existing [`apps/protected-panel-web/scripts/deploy-staging.mjs`](/home/reptilian/code/campus-agent/apps/protected-panel-web/scripts/deploy-staging.mjs) pattern.

### Pattern 2: Canonical Staging Preflight Before Publish

**What:** One ordered preflight gate blocks deploy before publish if staging shell env, Worker secrets, built config, or shared DB drift are not ready.

**When to use:** Every staging deploy path, before `wrangler deploy`.

**Repo-specific conclusion:** The repo already has the necessary pieces. Phase 1002 should compose them into one canonical contract rather than adding more ad hoc checks.

**Example:**

```bash
uv run --all-packages python scripts/doctor_env.py --surface worker-staging
uv run --all-packages python scripts/check_worker_secret_presence.py --env staging
pnpm --dir apps/public-chat-web deploy:verify-config:staging
pnpm --dir apps/protected-panel-web deploy:verify-config:staging
pnpm --dir apps/app-api db:reconcile-shared-drift:staging
```

Source: repo scripts plus Cloudflare Wrangler environment/secret scope docs.

### Pattern 3: Separate Access Envelope From Operator Admission

**What:** Panel staging first proves Cloudflare Access is correctly configured at the edge, then separately proves that `app-api` admits the operator identity.

**When to use:** Protected panel smoke, `/readyz` diagnosis, and `/api/operator/*` staging verification.

**Repo-specific conclusion:** This distinction already exists in architecture docs and runtime behavior; Phase 1002 should preserve and surface it in tests, docs, and acceptance criteria.

**Example:**

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = "https://team.example.cloudflareaccess.com";
const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

await jwtVerify(token, jwks, {
  issuer,
  audience: "real-panel-aud",
});

// Access success does not imply operator success.
// Operator allowlist/admission must still be checked by app-api.
```

Source: Cloudflare Access JWT validation docs and existing panel runtime in [`apps/protected-panel-web/src/index.ts`](/home/reptilian/code/campus-agent/apps/protected-panel-web/src/index.ts).

### Pattern 4: Release-Scoped Observability Closure

**What:** Post-deploy evidence is keyed by timestamp + environment + release, and includes real trace IDs plus runtime event proof.

**When to use:** Every staging closeout after a real deploy.

**Repo-specific conclusion:** Current runbooks still point at `.tmp/observability-smoke/<timestamp>/...`; Phase 1002 should tighten this to include release identity in the path and summary contract.

**Example:**

```text
.tmp/observability-smoke/2026-04-14T05-34-00Z-staging-app-api@staging-05c3d45/
├── SUMMARY.md
├── sentry-trace-notes.md
└── axiom-runtime-events.md
```

Source: [`docs/architecture/runtime-delivery-and-release-hardening-architecture.md`](/home/reptilian/code/campus-agent/docs/architecture/runtime-delivery-and-release-hardening-architecture.md) and [`docs/runbooks/worker-observability-smoke-runbook.md`](/home/reptilian/code/campus-agent/docs/runbooks/worker-observability-smoke-runbook.md).

### Anti-Patterns to Avoid

- **Static release in repo config:** Freezing `SENTRY_RELEASE` in `wrangler.toml` prevents per-deploy release truth.
- **Gate only on secrets:** Secrets alone do not catch missing `STAGING_*` shell inputs, wrong service bindings, or DB drift.
- **Treating Access as operator admission:** Passing Cloudflare Access does not prove `app-api` admits the operator.
- **Treating `/readyz` as closeout:** Health/readiness is only a prerequisite, not the deploy closure condition.
- **Using cached DB lane for auth-sensitive smoke:** It can hide stale auth state and produce false staging confidence.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Access JWT verification | Custom token parser or partial claim checks | Cloudflare Access validation flow with `jose` | Official guidance requires verifying the Access JWT against the team-domain certs endpoint plus issuer and AUD |
| Worker secret audit | Manual dashboard checklist | [`scripts/check_worker_secret_presence.py`](/home/reptilian/code/campus-agent/scripts/check_worker_secret_presence.py) | It reads required secrets from `wrangler.toml` and compares them to real Worker secret state |
| Built binding verification | Eyeballing generated `wrangler.json` | [`scripts/verify-worker-deploy-config.mjs`](/home/reptilian/code/campus-agent/scripts/verify-worker-deploy-config.mjs) | Prevents accidental `APP_API` binding mismatches between local and staging |
| Staging shell env readiness | Ad hoc shell notes | `doctor_env.py --surface worker-staging` | The repo already models required staging shell inputs explicitly |
| Fresh-read cache bypass | One-off query flags or runtime hacks | `APP_API_DB` / `APP_API_DB_FRESH` split | Cloudflare Hyperdrive caching behavior is explicit; repo already has the correct dual-lane pattern |

**Key insight:** Phase 1002 is not missing libraries. It is missing enforcement and closure around stack pieces the repo already has.

## Common Pitfalls

### Pitfall 1: Static Sentry Release Identity

**What goes wrong:** Different staging deploys collapse into one release bucket.

**Why it happens:** `SENTRY_RELEASE` is frozen in `wrangler.toml` instead of injected during deploy.

**How to avoid:** Remove static release vars from staging config and make deploy scripts derive the release from git SHA or an explicit CI identifier.

**Warning signs:** Worker tests assert a fixed release string in raw Wrangler config.

### Pitfall 2: Forgetting Wrangler Env Scope Rules

**What goes wrong:** Staging deploys silently miss required vars or secrets because operators assume env values inherit globally.

**Why it happens:** Wrangler environment-specific `vars` are non-inheritable; env-specific service bindings and secrets must be defined per environment.

**How to avoid:** Make staging preflight verify all required `STAGING_*` shell inputs and all env-specific secrets before publish.

**Warning signs:** Deploy works locally but staging runtime lacks a required hostname, secret, or binding.

### Pitfall 3: Misclassifying Access Failure vs Operator Failure

**What goes wrong:** Panel staging is marked broken for the wrong reason, delaying cutover.

**Why it happens:** Teams treat Cloudflare Access envelope success as equivalent to `app-api` operator admission.

**How to avoid:** Keep separate diagnostics for edge protection, operator allowlist/admission, and bridge/runtime readiness.

**Warning signs:** A request reaches the panel but returns `operator_identity_not_admitted`, yet the incident is described as an Access outage.

### Pitfall 4: Treating Drift Reconciliation as a Runbook Cleanup

**What goes wrong:** A published Worker deploy still points at a schema or ownership state the runtime does not expect.

**Why it happens:** `db:reconcile-shared-drift:staging` exists, but is not yet a canonical hard gate across the release path.

**How to avoid:** Make drift reconciliation mandatory before publish; keep actual migration execution explicit/manual.

**Warning signs:** Deploy succeeded, but operator or auth-sensitive flows fail only after release.

### Pitfall 5: Evidence Artifacts Without Release Identity

**What goes wrong:** Multiple staging smokes become hard to compare or audit.

**Why it happens:** Current runbook artifact paths are timestamp-only.

**How to avoid:** Include timestamp + environment + release in path and summary fields.

**Warning signs:** A trace note exists on disk, but cannot be cleanly matched to a specific deployed release.

## Code Examples

Verified patterns from official sources and repo truth:

### Custom Domain + Environment-Specific Service Binding

```toml
workers_dev = false

[[env.staging.routes]]
pattern = "campus-chat-staging.ayafeed.com"
custom_domain = true

[[env.staging.services]]
binding = "APP_API"
service = "app-api-staging"
```

Source: Cloudflare Workers custom domains and Wrangler environments docs.

### Cloudflare Access JWT Validation in a Worker

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = "https://team.example.cloudflareaccess.com";
const audience = "real-panel-aud";
const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

await jwtVerify(token, jwks, {
  issuer,
  audience,
});
```

Source: Cloudflare Access JWT validation docs.

### Deploy-Time Sentry Release Injection

```js
const release = process.env.STAGING_SENTRY_RELEASE?.trim() || `public-chat-web@staging-${gitSha}`;

spawnSync(
  "wrangler",
  ["deploy", "--config", "dist/public_chat_web/wrangler.json", "--var", `SENTRY_RELEASE:${release}`],
  { stdio: "inherit" },
);
```

Source: Sentry Cloudflare release docs and existing panel deploy script pattern.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static `SENTRY_RELEASE` in repo config | Deploy-time release injection keyed to the actual deploy | Current Sentry guidance; Phase 1002 should complete repo adoption | Release, source map, and evidence linkage stay per deploy |
| `workers.dev` exposure for business-critical staging | Custom domains with `workers_dev = false` | Current Cloudflare Workers guidance | Staging matches real hostname and Access posture |
| One DB lane for all reads | Cached + fresh dual Hyperdrive bindings for sensitive reads | Already adopted in repo truth | Auth-sensitive and read-after-write flows can bypass stale cache |
| `/readyz = 200` means deploy is done | Real trace + runtime event + release-scoped artifact closeout | Frozen in repo release-hardening architecture | Closeout is based on evidence, not only readiness |
| Panel edge protection treated as full operator readiness | Explicit split between Access admission and operator allowlist/admission | Already present in repo runtime architecture | Faster diagnosis and less false confidence in protected staging |

**Deprecated/outdated:**

- Static staging `SENTRY_RELEASE` in Wrangler config: replace with deploy-time injection.
- Timestamp-only observability artifact directories: replace with timestamp + environment + release.

## Open Questions

1. **Where should the canonical staging preflight live?**
   - What we know: the repo already has all required checks in existing scripts and package scripts.
   - What's unclear: whether the phase should add one repo-root command, one shared script, or normalize per-app `deploy:staging` scripts only.
   - Recommendation: choose one canonical command and have each Worker `deploy:staging` delegate to it; do not duplicate gate logic in three independent script implementations.

2. **Should Sentry deploy records be mandatory in this phase?**
   - What we know: Sentry supports deploy records, but current repo hardening architecture does not require them for closure.
   - What's unclear: whether the team wants Sentry-side deploy metadata as a hard release gate or just a later observability improvement.
   - Recommendation: keep deploy records runbook-only or backlog-only for Phase 1002; do not block release-hardening closeout on them.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `4.1.0` for JS/TS Worker tests; Python `unittest` via `uv run --all-packages` for repo scripts |
| Config file | Worker configs under each app plus repo Python test discovery; e.g. [`apps/app-api/vitest.worker.config.mts`](/home/reptilian/code/campus-agent/apps/app-api/vitest.worker.config.mts) |
| Quick run command | `pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts` |
| Full suite command | `pnpm web:typecheck && pnpm web:test && pnpm web:test:worker && pnpm web:test:integration && uv run --all-packages python -m unittest discover -s tests -t .` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| `P1002-01` | `app-api` staging config has no static `SENTRY_RELEASE`, and deploy script injects release identity | worker/unit | `pnpm --dir apps/app-api test:worker -- --reporter=verbose test/worker.test.ts` | ✅ |
| `P1002-02` | `public-chat-web` staging config has no static `SENTRY_RELEASE`, and staging deploy path injects release identity | worker/unit | `pnpm --dir apps/public-chat-web test:worker -- --reporter=verbose test/worker.test.ts` | ✅ |
| `P1002-03` | `protected-panel-web` keeps deploy-time Access vars and deploy-time release injection semantics | worker/unit | `pnpm --dir apps/protected-panel-web test:worker -- --reporter=verbose test/worker.test.ts` | ✅ |
| `P1002-04` | staging shell env and secret presence checks fail closed for missing inputs | unit | `uv run --all-packages python -m unittest tests.test_check_worker_secret_presence tests.test_doctor_env` | ✅ |
| `P1002-05` | auth-sensitive paths preserve fresh-lane behavior | worker/integration | `pnpm --dir apps/app-api test:worker -- --reporter=verbose test/auth-and-db.test.ts` | ✅ |
| `P1002-06` | observability lookup tooling can retrieve trace/runtime evidence after deploy | unit/manual hybrid | `uv run --all-packages python -m unittest tests.test_check_sentry_lookup_access tests.test_query_sentry_spans` | ✅ |
| `P1002-07` | real staging closure proves two traces, one runtime event, and a release-scoped artifact | manual-only | Manual runbook smoke against staging | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted Worker test plus targeted Python/unit test for the touched gate script
- **Per wave merge:** `pnpm web:test:worker` and `uv run --all-packages python -m unittest discover -s tests -t .`
- **Phase gate:** full JS/TS + Python suite green, then real staging smoke with release-scoped artifact evidence

### Wave 0 Gaps

- [ ] Extend [`apps/app-api/test/worker.test.ts`](/home/reptilian/code/campus-agent/apps/app-api/test/worker.test.ts) to assert absence of static staging `SENTRY_RELEASE` and presence of deploy-time injection.
- [ ] Extend [`apps/public-chat-web/test/worker.test.ts`](/home/reptilian/code/campus-agent/apps/public-chat-web/test/worker.test.ts) to assert absence of static staging `SENTRY_RELEASE` and presence of deploy-time injection.
- [ ] Add or extend tests around the canonical staging preflight composition so `doctor_env`, secret audit, config verification, and drift reconciliation are all wired into the enforced release path.
- [ ] Add release-scoped artifact naming verification if the phase introduces a script or template generator for observability closure; otherwise keep this requirement manual-only and explicit.

## Sources

### Primary (HIGH confidence)

- [`docs/architecture/product-runtime-architecture.md`](/home/reptilian/code/campus-agent/docs/architecture/product-runtime-architecture.md) - Worker product surfaces and ownership
- [`docs/architecture/runtime-delivery-and-release-hardening-architecture.md`](/home/reptilian/code/campus-agent/docs/architecture/runtime-delivery-and-release-hardening-architecture.md) - release-hardening architecture and closure rules
- [`docs/runbooks/staging-worker-deploy-runbook.md`](/home/reptilian/code/campus-agent/docs/runbooks/staging-worker-deploy-runbook.md) - current staging deploy truth and secret matrix
- [`docs/runbooks/worker-observability-smoke-runbook.md`](/home/reptilian/code/campus-agent/docs/runbooks/worker-observability-smoke-runbook.md) - current post-deploy observability process and artifact pattern
- [`apps/app-api/wrangler.toml`](/home/reptilian/code/campus-agent/apps/app-api/wrangler.toml) - current static `SENTRY_RELEASE` debt and dual Hyperdrive bindings
- [`apps/public-chat-web/wrangler.toml`](/home/reptilian/code/campus-agent/apps/public-chat-web/wrangler.toml) - current static `SENTRY_RELEASE` debt and staging service binding
- [`apps/protected-panel-web/scripts/deploy-staging.mjs`](/home/reptilian/code/campus-agent/apps/protected-panel-web/scripts/deploy-staging.mjs) - existing deploy-time release and Access var injection pattern
- [`scripts/doctor_env.py`](/home/reptilian/code/campus-agent/scripts/doctor_env.py) - existing `worker-staging` shell env readiness model
- [`scripts/check_worker_secret_presence.py`](/home/reptilian/code/campus-agent/scripts/check_worker_secret_presence.py) - existing Worker secret audit
- [`scripts/verify-worker-deploy-config.mjs`](/home/reptilian/code/campus-agent/scripts/verify-worker-deploy-config.mjs) - existing built-config gate
- Cloudflare subdomain guidance: https://developers.cloudflare.com/fundamentals/setup/manage-domains/manage-subdomains/
- Cloudflare Workers custom domains: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare `workers.dev`: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- Cloudflare Wrangler environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare Workers environment variables: https://developers.cloudflare.com/workers/configuration/environment-variables/
- Cloudflare Access protected HTTP apps: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/
- Cloudflare Access JWT validation: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
- Cloudflare Hyperdrive query caching: https://developers.cloudflare.com/hyperdrive/configuration/query-caching/
- Sentry releases overview: https://docs.sentry.io/product/releases/
- Sentry Cloudflare release config: https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/releases/
- Sentry Cloudflare environment variables: https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/environments/
- Sentry release naming: https://docs.sentry.io/product/releases/naming-releases/
- Sentry deploy API: https://docs.sentry.io/api/releases/create-a-deploy/

### Secondary (MEDIUM confidence)

- `npm view wrangler version time --json`
- `npm view @sentry/cloudflare version time --json`
- `npm view jose version time --json`
- `npm view drizzle-kit version time --json`

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - official Cloudflare/Sentry docs plus current repo manifests and registry verification
- Architecture: HIGH - canonical repo architecture docs, runbooks, and direct audit of Worker configs/scripts/tests agree
- Pitfalls: HIGH - based on current repo debt plus official env/release/Auth guidance

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 for planning purposes; re-verify package versions and external docs if implementation starts later
