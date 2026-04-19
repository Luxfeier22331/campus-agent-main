# public-chat-web

Cloudflare Worker-hosted public chat web surface for campus-agent v2.

This app is the forward canonical public browser surface in front of shared `apps/app-api`.

Implementation status:

- `/login` and `/register` now run from the repo-owned route tree in `src/routes/app-router.tsx`, but the visible auth shell is the vendored donor auth shell with repo-owned Better Auth action adapters and campus product copy in `src/login/`
- the default `/chat` + `/chat/:conversationId` routes now render the vendor chat runtime through `src/platform/chat/app-shell.tsx`
- the vendored donor source of truth now lives in `vendor/vercel-ai-chatbot/`
- the runtime chat shell now resolves `@/*` into the vendored donor tree; vendor-owned `ChatShell` and `AppSidebar` are the active chat UI source of truth
- repo-owned chat runtime seams now live in `src/platform/`; route ownership now lives in `src/routes/` and `src/login/`
- the former `src/chatbot-donor/` compatibility layer and its Next/Auth shims have been removed from the runtime path
- the former `src/chatbot-shell/` transitional shell and duplicate `src/public-chat/auth.ts` client have been retired from the app source tree
- the remaining `src/public-chat` API/types transition files have been merged into `src/platform/chat/`; the app source tree no longer keeps a separate `public-chat` directory
- the former hand-written `ChatHomePage` / `ChatThreadPage` route implementation has been removed from the runtime path; `src/styles.css` now only serves the boot fallback
- the first runtime cutover record is retained in `docs/plans/public-chat-web-chatbot-replatform.md` as a historical plan, not the current implementation source of truth
- the donor-first reset record is retained in `docs/plans/public-chat-web-donor-first-reset.md` as historical closeout context
- the strict parity closeout record is tracked in `docs/plans/public-chat-web-vendor-runtime-full-transplant.md`; `2026-04-09` fresh local gate + authenticated staging smoke have closed the strict donor parity release gate, with the authoritative evidence pack fixed at `.tmp/staging-smoke/20260409T232000+0800-public-chat-wave6-closeout-2/`
- the donor tech-debt convergence closeout is tracked in `docs/plans/public-chat-web-vendor-tech-debt-convergence.md`; Wave 5 local verification is now closed with evidence at `.tmp/local-smoke/20260411T163903+0800-public-chat-wave5-closeout/`, and further work should move to repo-level post-closeout follow-up instead of reopening donor convergence
- the current shell parity inventory lives in `docs/reference/public-chat-web-route-state-parity-inventory.md`
- the current donor diff classification inventory lives in `docs/reference/public-chat-web-donor-diff-classification.md`
- the accepted donor diff whitelist lives in `docs/reference/public-chat-web-donor-diff-whitelist.md`
- the historical donor drift inventory for the retired transitional shell lives in `docs/reference/public-chat-web-donor-drift-inventory.md` and is no longer an active blocker list
- the current strict donor parity gap inventory lives in `docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md`
- the forward runtime now stays only in `vendor/vercel-ai-chatbot/` + `src/platform/` + `src/routes/` + `src/login/`
- the temporary `/chat/replatform-preview*` debug seam has been removed; `/chat` is now the only chat route family
- legacy hits to `/chat/replatform-preview*` are canonicalized by the Worker shell back to `/chat`, so the removed preview prefix cannot fall through as a fake `conversationId`
- future donor-visible drift outside `docs/reference/public-chat-web-donor-diff-whitelist.md` is a regression, not an allowed continuation

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
- `GET /register`
- `GET /forgot-password`
- `GET /reset-password`
- `GET /chat`
- `GET /chat/:conversationId`
- `ALL /api/*`

Current chat contract assumptions:

- the browser always talks to same-site `/api/*` routes on this Worker
- `GET /api/me` resolves the current Better Auth session through shared `app-api`
- `POST /api/chat/requests` is the primary chat command route
- `public-chat-web` now reserves `/chat/:conversationId` before first send and always submits that route-owned `conversationId`
- `POST /api/chat/conversations` remains available only for explicit empty-draft creation
- donor-style message edit trims conversation tail through `DELETE /api/chat/conversations/:conversationId/messages/:messageId/trailing`

UI behavior:

- `/login` renders the donor sign-in shell against shared Better Auth endpoints, keeps campus-specific product copy, and routes password recovery into `/forgot-password`
- `/register` renders the donor register shell against shared Better Auth endpoints and keeps the campus-email helper copy inside the same auth family shell
- `/login`, `/register`, and `/forgot-password` require a Turnstile challenge before their same-site Better Auth submission is sent
- `/forgot-password` stays enumeration-safe and only confirms that a reset link will be sent if the account is eligible
- `/reset-password` finishes the same-site recovery flow without adding a second captcha step
- `/chat` is the first-turn chat surface and conversation history view
- `/chat/:conversationId` continues an existing owned conversation
- the left rail uses donor-style paginated history from `GET /api/history`
- a successful first-turn `POST /api/chat/requests` must revalidate that donor history key so the sidebar updates without a manual reload

Canonical references:

- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/plans/public-chat-web-vendor-runtime-full-transplant.md`
- `docs/plans/public-chat-web-vendor-tech-debt-convergence.md`
- `docs/reference/public-chat-web-chatbot-donor-baseline.md`
- `docs/reference/public-chat-web-donor-diff-classification.md`
- `docs/reference/public-chat-web-donor-diff-whitelist.md`
- `docs/reference/public-chat-web-donor-parity-review-checklist.md`
- `docs/reference/public-chat-web-route-state-parity-inventory.md`
- `docs/reference/public-chat-web-strict-donor-parity-gap-inventory.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`

Environment:

- `PUBLIC_CHAT_APP_NAME`
- `PUBLIC_CHAT_HOSTNAME`
- `AUTH_TURNSTILE_SITE_KEY`
- `APP_API_BASE_URL`

The Worker also requires an internal `APP_API` service binding at runtime.

Readiness expectations:

- `GET /readyz` stays `503` until `APP_API`, `ASSETS`, `APP_API_BASE_URL`, and `PUBLIC_CHAT_HOSTNAME` are all configured
- public chat shell routes such as `/login` and `/chat` also stay fail-closed when the `APP_API` bridge is missing, so a bad deploy does not expose a broken SPA
- `pnpm deploy` now fails before publish if the generated Worker deploy config loses the required `APP_API` service binding
- proxied same-site `/api/*` responses are forced to `Cache-Control: no-store`
- missing `AUTH_TURNSTILE_SITE_KEY` does not take Worker readiness down, but it leaves the public auth family unable to complete its captcha-gated submit path

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
pnpm dev:live-smoke
```

Local dev notes:

- `pnpm dev` keeps the SPA shell isolated to `public-chat-web`; it is useful for frontend-only iteration, but it is not the canonical browser smoke path for the `APP_API` service binding.
- `pnpm dev:live-smoke` is the canonical local browser smoke entry. It boots `public-chat-web` on `http://127.0.0.1:5173` and brings up `apps/app-api` as a Cloudflare Vite auxiliary Worker from `../app-api/wrangler.local-smoke.toml`, so same-site `/api/*` requests resolve through the real Worker service binding instead of depending on two separate `pnpm dev` sessions finding each other.
- before `pnpm dev:live-smoke`, run `pnpm --dir apps/app-api db:bootstrap` whenever local Postgres may lag `apps/app-api/db/shared-product-migrations/*` after a pull or schema change. The local `chat.*` bootstrap migrations are not covered by `db:reconcile-shared-drift`; if they lag, `POST /api/chat/requests` can fail even when the chat shell itself is healthy.
- local auth smoke should use Cloudflare Turnstile testing sitekeys; staging must use the real sitekey admitted for `campus-chat-staging.ayafeed.com`
