# public-chat-web

Cloudflare Worker-hosted public chat web surface for campus-agent v2.

This app is the forward canonical public browser surface in front of shared `apps/app-api`.

It owns:

- public chat UI
- browser-side login and chat routes
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
- `GET /chat`
- `GET /chat/:conversationId`
- `ALL /api/*`

Current chat contract assumptions:

- the browser always talks to same-site `/api/*` routes on this Worker
- `GET /api/me` resolves the current Better Auth session through shared `app-api`
- `POST /api/chat/requests` is the primary chat command route
- first-turn chat requests may omit `conversationId`; `app-api` lazy-creates the canonical conversation
- `POST /api/chat/conversations` remains available only for explicit empty-draft creation

UI behavior:

- `/login` provides email/password sign-in and sign-up against shared Better Auth endpoints
- `/chat` is the first-turn chat surface and conversation history view
- `/chat/:conversationId` continues an existing owned conversation
- the left rail uses conversation summaries from `GET /api/chat/conversations`

Canonical references:

- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/long-term-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`

Environment:

- `PUBLIC_CHAT_APP_NAME`
- `PUBLIC_CHAT_HOSTNAME`
- `APP_API_BASE_URL`

The Worker also requires an internal `APP_API` service binding at runtime.

Readiness expectations:

- `GET /readyz` stays `503` until `APP_API`, `ASSETS`, `APP_API_BASE_URL`, and `PUBLIC_CHAT_HOSTNAME` are all configured
- `pnpm deploy` now fails before publish if the generated Worker deploy config loses the required `APP_API` service binding
- proxied same-site `/api/*` responses are forced to `Cache-Control: no-store`

Observability:

- this Worker attaches Sentry at the runtime shell only; `app-api` remains the main observability owner
- outgoing same-site `/api/*` proxy requests preserve `x-trace-id` and also propagate `sentry-trace` / `baggage` into `app-api`
- proxied `/api/auth/*` requests also preserve browser `Origin` and `Referer` so shared Better Auth origin / CSRF checks stay effective; other `/api/*` routes keep the narrower header allowlist
- Sentry stays fail-open when `SENTRY_DSN` is unset
- raw cookies, raw prompt/answer text, and other auth material are not intended to enter the sink

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
```
