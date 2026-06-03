# public-chat-web

Cloudflare Worker-hosted public chat web surface for campus-agent v2.

This app is the forward canonical public browser surface in front of shared
`apps/app-api`.

Current runtime composition:

- chat route ownership lives in `src/routes/`
- `/login`, `/register`, `/forgot-password`, and `/reset-password` are bounded
  compatibility redirects/shims to `apps/hub-web` account routes
- `/chat` and `/chat/:conversationId` render the vendored chat runtime through
  `src/platform/chat/app-shell.tsx`
- vendored UI/runtime source-of-truth lives in `vendor/vercel-ai-chatbot/`
- `vendor/vercel-ai-chatbot/` is a donor snapshot for parity review and import
  compatibility. It is excluded from repo-owned decomposition gates and must not
  be used as architecture precedent for new fallback, best-effort, or local
  compatibility behavior in `src/`, `apps/app-api`, or shared packages.
- repo-owned platform seams live in `src/platform/`
- exact import-compat ownership lives in `src/platform/vendor-compat/`
- `src/styles.css` only serves the boot placeholder; the active chat shell comes
  from the vendored runtime

It owns:

- public chat UI
- browser-side chat routes
- compatibility redirects from legacy chat-local auth URLs to hub account routes
- same-site `/api/*` proxy seam into `apps/app-api`
- minimal health/readiness contract

It does not own:

- auth/session/conversation truth
- chat request ledger or request projection truth
- direct browser access to `apps/supervisor-api`

Current route scope:

- `GET /healthz`
- `GET /readyz`
- `GET /login`
- `GET /register`
- `GET /forgot-password`
- `GET /reset-password`
- `GET /chat`
- `GET /chat/:conversationId`
- `ALL /api/*`

Current chat contract assumptions:

- the browser always talks to same-site `/api/*` routes on this Worker
- `GET /api/me` resolves the current Better Auth session through shared
  `app-api`
- `POST /api/chat/requests` is the primary chat command route
- `public-chat-web` now reserves `/chat/:conversationId` before first send and
  always submits that route-owned `conversationId`
- `POST /api/chat/conversations` remains available only for explicit empty-draft
  creation
- message edit trims conversation tail through `DELETE
  /api/chat/conversations/:conversationId/messages/:messageId/trailing`

UI behavior:

- `/login`, `/register`, `/forgot-password`, and `/reset-password` redirect to
  hub account routes and preserve a sanitized `return_to`
- `/chat` is the first-turn chat surface and conversation history view
- `/chat/:conversationId` continues an existing owned conversation
- the left rail uses paginated history from `GET /api/history`
- a successful first-turn `POST /api/chat/requests` must revalidate the history
  key so the sidebar updates without a manual reload

Canonical references:

- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/reference/public-chat-web-donor-diff-classification.md`
- `docs/reference/public-chat-web-donor-parity-review-checklist.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`

Environment:

- `PUBLIC_CHAT_APP_NAME`
- `PUBLIC_CHAT_HOSTNAME`
- `APP_API_BASE_URL`
- `HUB_WEB_BASE_URL`

The Worker also requires an internal `APP_API` service binding at runtime.

Readiness expectations:

- `GET /readyz` stays `503` until `APP_API`, `ASSETS`, `APP_API_BASE_URL`,
  `PUBLIC_CHAT_HOSTNAME`, and `HUB_WEB_BASE_URL` are all configured
- `GET /readyz` forwards the app-api `preflight.campusServicesProductPath`
  diagnostic block when it is present, so public/chat campus-services opening
  checks can distinguish capability-gate, projection, and read-model blockers
- public chat shell routes such as `/chat` stay fail-closed
  when the `APP_API` bridge is missing, so a bad deploy does not expose a broken
  SPA
- `pnpm deploy` now fails before publish if the generated Worker deploy config
  loses the required `APP_API` service binding
- proxied same-site `/api/*` responses are forced to `Cache-Control: no-store`
- auth challenge runtime config is no longer owned by public-chat; hub owns the
  account shell and Turnstile widget posture

Observability:

- this Worker attaches Sentry at the runtime shell only; `app-api` remains the
  main observability owner
- outgoing same-site `/api/*` proxy requests preserve `x-trace-id` and also
  propagate `sentry-trace` / `baggage` into `app-api`
- proxied `/api/auth/*` requests also preserve browser `Origin` and `Referer` so
  shared Better Auth origin / CSRF checks stay effective; other `/api/*` routes
  keep the narrower header allowlist
- Sentry is optional runtime-shell telemetry; when `SENTRY_DSN` is unset it is
  disabled and does not change chat request admission
- raw cookies, raw prompt/answer text, and other auth material are not intended
  to enter the sink

Additional env:

- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

Local commands:

```bash
pnpm install
pnpm build
pnpm test
pnpm test:worker
pnpm typecheck
pnpm dev
pnpm dev:live-smoke
```

Local dev notes:

- `pnpm dev` keeps the SPA shell isolated to `public-chat-web`; it is useful for
  frontend-only iteration, but it is not the canonical browser smoke path for
  the `APP_API` service binding.
- `pnpm dev:live-smoke` is the canonical local browser smoke entry. It boots
  `public-chat-web` on `<http://127.0.0.1:27011`> and brings up `apps/app-api` as
  a Cloudflare Vite auxiliary Worker from
  `../app-api/wrangler.local-smoke.toml`, so same-site `/api/*` requests resolve
  through the real Worker service binding instead of depending on two separate
  `pnpm dev` sessions finding each other.
- before `pnpm dev:live-smoke`, run `pnpm --dir apps/app-api db:bootstrap`
  whenever local Postgres may lag `apps/app-api/db/shared-product-migrations/*`
  after a pull or schema change. The local `chat.*` bootstrap migrations are not
  covered by `db:reconcile-shared-drift`; if they lag, `POST /api/chat/requests`
  can fail even when the chat shell itself is healthy.
- legacy chat-local auth UI smoke exists only for compatibility regression
  tests; hub owns current account-shell smoke and staging Turnstile posture
