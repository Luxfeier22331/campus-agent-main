# operator-console-web

Cloudflare Worker shell for the controlled Operator Console surface.

This app only owns the browser shell, static assets, Worker-local readiness and
an explicit allowlist of proxied operator routes into `apps/app-api`. It must not
become a second operator backend, a generic admin platform, or a direct browser
client for execution-control, Temporal, PG, Sentry or Axiom.

## Current Surface

- protected SPA routes for the current operator workflows
- `GET /healthz`
- `GET /readyz`
- Worker-local `/api/*` routes that proxy only admitted app-api operator APIs
- no generic `/api/*` passthrough

The current product and proxy surface is defined by:

- `docs/architecture/system/operator-console.md`
- `docs/architecture/system/product-runtime.md`
- `docs/contracts/app-api/operator.md`
- `docs/contracts/app-api/operator-ops.md`
- `docs/contracts/app-api/observability.md`

## Runtime Env

- `OPERATOR_CONSOLE_APP_NAME`
- `OPERATOR_CONSOLE_APP_API_SHARED_SECRET`
- `OPERATOR_CONSOLE_APP_API_BASE_URL`
- `OPERATOR_CONSOLE_PROTECTION_ENVELOPE`
- `ACCESS_TEAM_DOMAIN`
- `ACCESS_POLICY_AUD`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

Required bindings:

- `APP_API`
- `ASSETS`

`/readyz` must fail closed until the trusted app-api bridge, assets, shared
secret and Cloudflare Access assertion settings are configured.

## Local Commands

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

Authenticated local smoke uses the same signed-assertion admission path as the
Worker:

```bash
node apps/operator-console-web/scripts/local-access-smoke-server.mjs
cd apps/operator-console-web
OPERATOR_CONSOLE_LIVE_SMOKE=1 pnpm dev
```

Then open:

```text
http://127.0.0.1:27062/login?redirect=http://127.0.0.1:27021/observability/overview
```

## Operational Notes

- Proxied panel API responses are `Cache-Control: no-store`.
- Raw Access JWTs, cookies, operator email, prompt text, answer text and
  transcript text must not enter telemetry sinks.
- Local smoke requires a compatible `apps/app-api` runtime and, for runtime
  health checks, `apps/execution-control`.
- Missing dining seed or eval coverage snapshot should surface the governed
  backend diagnostic state, not synthesized frontend data.
