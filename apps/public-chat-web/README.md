# public-chat-web

Cloudflare Worker-hosted public chat web surface for campus-agent v2.

This app is the forward canonical public browser surface in front of shared `apps/app-api`.

Implementation status:

- `/login` now runs from the repo-owned route tree in `src/routes/app-router.tsx` + `src/login/page.tsx`
- the default `/chat` + `/chat/:conversationId` routes now render the vendor chat runtime through `src/platform/chat/app-shell.tsx`
- the vendored donor source of truth now lives in `vendor/vercel-ai-chatbot/`
- the runtime chat shell now resolves `@/*` into the vendored donor tree; vendor-owned `ChatShell` and `AppSidebar` are the active chat UI source of truth
- repo-owned chat runtime seams now live in `src/platform/`; route ownership now lives in `src/routes/` and `src/login/`
- the former `src/chatbot-donor/` compatibility layer and its Next/Auth shims have been removed from the runtime path
- the former `src/chatbot-shell/` transitional shell and duplicate `src/public-chat/auth.ts` client have been retired from the app source tree
- the remaining `src/public-chat` API/types transition files have been merged into `src/platform/chat/`; the app source tree no longer keeps a separate `public-chat` directory
- the former hand-written `ChatHomePage` / `ChatThreadPage` route implementation has been removed from the runtime path; `src/styles.css` now only serves the login surface, route status cards, and boot fallback
- the first runtime cutover plan is recorded in `docs/plans/public-chat-web-chatbot-replatform.md`
- the active donor-first reset plan is tracked in `docs/plans/public-chat-web-donor-first-reset.md`
- the next forward runtime convergence plan is tracked in `docs/plans/public-chat-web-vendor-runtime-full-transplant.md`; the current worktree has completed the TanStack Router + platform seam cutover and retired the old transitional shell
- the current shell parity inventory lives in `docs/reference/public-chat-web-route-state-parity-inventory.md`
- the current donor drift inventory lives in `docs/reference/public-chat-web-donor-drift-inventory.md`
- the forward runtime now stays only in `vendor/vercel-ai-chatbot/` + `src/platform/` + `src/routes/` + `src/login/`
- the temporary `/chat/replatform-preview*` debug seam has been removed; `/chat` is now the only chat route family
- legacy hits to `/chat/replatform-preview*` are canonicalized by the Worker shell back to `/chat`, so the removed preview prefix cannot fall through as a fake `conversationId`

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

- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/plans/public-chat-web-chatbot-replatform.md`
- `docs/reference/public-chat-web-chatbot-donor-baseline.md`
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
- public chat shell routes such as `/login` and `/chat` also stay fail-closed when the `APP_API` bridge is missing, so a bad deploy does not expose a broken SPA
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
