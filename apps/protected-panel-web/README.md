# protected-panel-web

Protected panel web runtime shell for campus-agent v2.

This app is an `apps/*` protected operator surface. It exists as a runtime shell only:

- it remains separate from `apps/supervisor-api`
- it consumes runtime APIs only
- it does not import `packages/*` directly
- it stays fail-closed by default
- it uses controlled operator access instead of a full end-user account system
- its long-term runtime is frozen to `Cloudflare Workers`
- its preferred UI shell is an open-source admin framework, with `react-admin` as the first-choice direction
- its preferred Worker-local BFF direction is `Hono`

Current shell scope:

- `GET /healthz`
- `GET /readyz`
- `GET /` and protected SPA routes such as `/requests`
- `GET /api/overview`
- `GET /api/requests`
- `GET /api/requests/:requestId`

The root route and protected SPA routes now serve the `react-admin` shell once upstream operator admission, frontend assets, and the trusted panel-to-`app-api` bridge are configured. If any of those assumptions are missing, the Worker fails closed instead of exposing a public panel shell.

Canonical references:

- `docs/architecture/protected-panel-boundary.md`
- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/protected-panel-operator-access.md`
- `docs/architecture/protected-panel-runtime-shell.md`
- `docs/architecture/request-projection-and-runtime-read-model.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0011-protected-panel-worker-runtime.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`

Implementation references:

- `apps/protected-panel-web/REACT-ADMIN-REFERENCE.md`
- `.planning/protected-panel-worker-implementation-plan.md`
- `.planning/protected-panel-runtime-api-inventory.md`

Historical handoff:

- `.planning/phases/04.4-protected-internal-panel-runtime-shell-inserted/04.4-IMPLEMENTATION-HANDOFF.md`

Long-term operator access assumptions:

- Cloudflare Access or another controlled upstream identity source gates the protected hostname
- origin admission must validate `Cf-Access-Jwt-Assertion` or an equivalent signed access assertion
- the app maps only minimal operator context; it does not own self-serve signup, password reset, or profile management
- dynamic HTML/API responses remain fail-closed and non-public-cache by default

Long-term functional domains:

- `Overview`
- `Requests`
- `Jobs`
- `Operations`
- `Audit`

Current rollout default:

- `Overview` is implemented as the runtime and operator-context landing page
- `Requests` is implemented as a request projection list/detail surface through `react-admin`
- `Jobs` and `Operations` are delayed pending re-discussion
- `Audit` currently remains a delayed route skeleton rather than a raw-log viewer

`Requests` is defined against `apps/app-api` owned request projection APIs. This app must not treat consumer chat persistence, raw audit logs, or telemetry sinks as canonical request list/detail sources.

Requests UX notes:

- list/detail views are projection snapshots, not execution replay pages
- pagination is cursor-backed and intentionally supports sequential next-page navigation only
- freshly completed chat requests can appear slightly later than the chat response because projection materialization is eventually consistent

UI / BFF direction:

- `react-admin` is the preferred UI shell
- the open-source default `<Layout>` is the starting layout
- the `Help Desk` demo is a reference, not a template to clone wholesale
- `Hono` is the preferred Worker-local BFF layer
- `ContainerLayout`, `SolarLayout`, `Appsmith`, and `ToolJet` are not the current default path

Environment:

- `PANEL_APP_NAME`
- `PANEL_APP_API_SHARED_SECRET`
- `PANEL_RUNTIME_API_BASE_URL`
- `PANEL_PROTECTED_HOSTNAME`
- `PANEL_PROTECTION_ENVELOPE`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_POLICY_AUD`

Runtime bindings:

- `APP_API` service binding for request projection list/detail queries
- `ASSETS` binding generated from the Vite client build

Readiness expectations:

- `GET /readyz` stays `503` until `APP_API`, `ASSETS`, hostname/runtime base URL, and `PANEL_APP_API_SHARED_SECRET` are all configured
- when `PANEL_PROTECTION_ENVELOPE=cloudflare-access`, `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` are also mandatory for readiness
- proxied panel API responses are forced to `Cache-Control: no-store`

Current operator-access env contract for Cloudflare Access admission includes:

- access issuer / team-domain configuration for assertion validation
- access audience configuration

Later env expansion is still expected to add values such as:

- operator identity claim mapping
- audit sink / trace projection configuration
- app-api request projection runtime API configuration beyond the current `APP_API` service binding

Observability:

- this Worker attaches Sentry at the protected shell only; it does not become the telemetry owner or panel truth source
- proxied panel queries preserve canonical `x-trace-id` and also forward `sentry-trace` / `baggage` into `app-api`
- operator-facing `Requests` still read `operator.request_projection`; telemetry sinks are debugging/analysis surfaces only
- raw Access JWTs, cookies, operator email, prompt text, answer text, and transcript text are not intended to enter the sink

Additional env:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

This app does not close retrieval ACL, actor mapping, approval flow, or full governance semantics. It also does not exist to become a CMS, database console, or generic admin platform.

Local commands:

```bash
pnpm install
pnpm build
pnpm preview
pnpm test
pnpm typecheck
pnpm dev
pnpm deploy
```
