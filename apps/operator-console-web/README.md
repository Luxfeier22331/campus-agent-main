# operator-console-web

Operator Console web runtime shell for campus-agent v2.

This app is an `apps/*` protected operator surface. It exists as a runtime shell
only:

- it remains separate from `apps/execution-control`
- it consumes runtime APIs only
- it does not import `packages/*` directly
- it stays fail-closed by default
- it uses controlled operator access instead of a full end-user account system
- its long-term runtime is frozen to `Cloudflare Workers`
- its preferred UI shell is an open-source admin framework, with `react-admin`
  as the first-choice direction
- its preferred Worker-local BFF direction is `Hono`

Current shell scope:

- `GET /healthz`
- `GET /readyz`
- `GET /` and protected SPA routes such as `/observability/overview`,
  `/requests`, `/officialWebSites`, `/authenticatedNoticeProcessing`,
  `/operations/dining`, and `/operations/provider-config`
- Worker-local `GET /api/overview` for protected admission / operator-context
  smoke only
- explicit proxied operator observability routes such as
  `GET /api/operator/overview`, `GET /api/operator/runtime/health`,
  `GET /api/operator/quality/*`, `GET /api/operator/intent/*`,
  `GET /api/operator/safety/*`, `GET /api/operator/cost/*`,
  `GET /api/operator/evals/coverage`, and `GET /api/operator/audit*`
- explicit proxied request projection routes under `/api/requests*`
- explicit proxied official-web operator projection routes under
  `/api/official-web/*`
- explicit proxied authenticated-notice processing routes under
  `/api/authenticated-notices/*`
- explicit proxied dining operations routes under `/api/ops/dining/*`
- explicit proxied provider configuration routes under
  `/api/operator/provider-config/*`

The root route and protected SPA routes now serve the `react-admin` shell once
upstream operator admission, frontend assets, and the trusted panel-to-`app-api`
bridge are configured. If any of those assumptions are missing, the Worker fails
closed instead of exposing a public panel shell.

Canonical references:

- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0011-operator-console-worker-runtime.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-operator-console-query-ownership.
  md`

Implementation references:

- `apps/operator-console-web/REACT-ADMIN-REFERENCE.md`
- `git history shared product surfaces acceptance plan`
- `git history Operator Console requests triage redesign plan`
- `git history Operator Console runtime API inventory`

Long-term operator access assumptions:

- Cloudflare Access or another controlled upstream identity source gates the
  protected hostname
- origin admission must validate `Cf-Access-Jwt-Assertion` or an equivalent
  signed access assertion
- the app maps only minimal operator context; it does not own self-serve signup,
  password reset, or profile management
- dynamic HTML/API responses remain fail-closed and non-public-cache by default

Current functional domains:

- `Observability`: overview, runtime health, quality, eval coverage, intent,
  safety, cost, and audit
- `Requests`: request projection list/detail and request-level observability
- `Official Web`: operator-safe official-web projections
- `Authenticated Notice Processing`: operator-safe notice processing projections
- `Operations`: dining operations and provider configuration

Current rollout default:

- `Overview` is implemented as the operator observability landing page and
  includes runtime health from `app-api /api/operator/runtime/health`
- `Requests` is implemented as a request projection list/detail surface through
  `react-admin`
- `Official Web` is implemented as operator projection list/detail surfaces
- `Authenticated Notice Processing` is implemented as operator-safe processing
  projection list/detail surfaces
- `Operations` currently includes dining operations and provider configuration
- `Audit` is implemented as an operator-safe projection surface, not a raw-log
  viewer
- `apps/app-api` has campus-services operator routes, but this Worker does not
  currently expose a campus-services correction / release workspace

`Requests` is defined against `apps/app-api` owned request projection APIs. This
app must not treat consumer chat persistence, raw audit logs, or telemetry sinks
as canonical request list/detail sources.

Requests UX notes:

- list/detail views are projection snapshots, not execution replay pages
- pagination is cursor-backed and intentionally supports sequential next-page
  navigation only
- freshly completed chat requests can appear slightly later than the chat
  response because projection materialization is eventually consistent

UI / BFF direction:

- `react-admin` is the preferred UI shell
- the open-source default `<Layout>` is the starting layout
- the `Help Desk` demo is a reference, not a template to clone wholesale
- `Hono` is the preferred Worker-local BFF layer
- `ContainerLayout`, `SolarLayout`, `Appsmith`, and `ToolJet` are not the
  current default path

Environment:

- `OPERATOR_CONSOLE_APP_NAME`
- `OPERATOR_CONSOLE_APP_API_SHARED_SECRET`
- `OPERATOR_CONSOLE_APP_API_BASE_URL`
- `OPERATOR_CONSOLE_PROTECTION_ENVELOPE`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_POLICY_AUD`

Hostname mapping:

- the protected hostname is owned by `wrangler.toml` Custom Domain deploy
  config, not by runtime env
- staging `ACCESS_TEAM_DOMAIN` / `ACCESS_POLICY_AUD` are deploy-time injected
  and must not be hardcoded into `wrangler.toml`

Runtime bindings:

- `APP_API` service binding for explicit operator domain proxy routes
- `ASSETS` binding generated from the Vite client build

Readiness expectations:

- `GET /readyz` stays `503` until `APP_API`, `ASSETS`, runtime base URL,
  `OPERATOR_CONSOLE_APP_API_SHARED_SECRET`, `OPERATOR_CONSOLE_PROTECTION_ENVELOPE=cloudflare-access`,
  `ACCESS_TEAM_DOMAIN`, and `ACCESS_POLICY_AUD` are all configured
- placeholder Access defaults such as `<https://team.cloudflareaccess.com`> and
  `panel-audience` are treated as not configured
- `GET /readyz` also probes shared `app-api /readyz`; panel readiness is not
  green until shared runtime dependencies are actually ready
- shell routes and Worker-local `/api/overview` stay fail-closed until upstream
  admission, the trusted `APP_API` bridge, and frontend assets are all
  configured
- when admission config is missing or `OPERATOR_CONSOLE_PROTECTION_ENVELOPE` is
  not `cloudflare-access`, the Worker fails closed for the shell and
  Worker-local `/api/overview` instead of exposing a partially Operator Console
  surface
- `pnpm deploy` now fails before publish if the generated Worker deploy config
  loses the required `APP_API` service binding
- `pnpm deploy:staging` also fails before publish unless
  `STAGING_ACCESS_TEAM_DOMAIN` and `STAGING_ACCESS_POLICY_AUD` are explicitly
  provided
- `pnpm deploy:staging` injects
  `SENTRY_RELEASE=operator-console-web@staging-<git-sha>` by default; use
  `STAGING_SENTRY_RELEASE` only when a fixed release override is required
- proxied panel API responses are forced to `Cache-Control: no-store`

Current operator-access env contract for Cloudflare Access admission includes:

- access issuer / team-domain configuration for assertion validation
- access audience configuration

Later env expansion is still expected to add values such as:

- operator identity claim mapping
- audit sink / trace projection configuration
- app-api request projection runtime API configuration beyond the current
  `APP_API` service binding

Observability:

- this Worker attaches Sentry at the protected shell only; it does not become
  the telemetry owner or panel truth source
- proxied panel queries preserve canonical `x-trace-id` and also forward
  `sentry-trace` / `baggage` into `app-api`
- operator-facing `Requests` still read `operator.request_projection`; telemetry
  sinks are debugging/analysis surfaces only
- raw Access JWTs, cookies, operator email, prompt text, answer text, and
  transcript text are not intended to enter the sink

Additional env:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

This app does not close retrieval ACL, actor mapping, approval flow, or full
governance semantics. It also does not exist to become a CMS, database console,
or generic admin platform.

Local commands:

```bash
pnpm install
pnpm build
pnpm preview
pnpm test
pnpm test:worker
pnpm typecheck
pnpm dev
pnpm deploy
```

Authenticated local smoke:

```bash
pnpm --dir apps/operator-console-web dev:live-smoke:access
pnpm --dir apps/operator-console-web dev:live-smoke
```

Then enter through:

```text
http://127.0.0.1:27062/login?redirect=http://127.0.0.1:27021/observability/overview
```

The local Access smoke server issues a signed `CF_Authorization` cookie and
serves the matching JWKS at `/cdn-cgi/access/certs`. This keeps local smoke on
the same signed-assertion admission path as the Worker instead of adding a
panel-side bypass.

Local browser smoke preconditions:

- start or reuse local `apps/app-api` with the same shared secret expected by
  `operator-console-web`
- start `apps/execution-control` before treating Runtime Health as ready; if
  `app-api /api/operator/runtime/health` reports the execution-control
  projection as blocked, the panel must show that diagnostic instead of
  inventing a frontend-ready state
- migrate/bootstrap the shared local database when schema drift is possible:
  `pnpm --dir apps/app-api db:bootstrap`
- seed dining operations before expecting the dining workspace to show editable
  floors: `pnpm --dir apps/app-api dining:seed-initial-release`
- publish a real eval coverage snapshot before expecting Eval Coverage to show
  the coverage matrix; if none has been published, the page shows the governed
  empty state `尚未发布评测覆盖快照。`

For local smoke, `dining_operations_state_invalid` and
`eval_coverage_snapshot_not_found` are valid diagnostic outcomes when their
preconditions are absent. They are not frontend fallback paths, and the panel
must not auto-seed dining data or synthesize eval coverage data.
