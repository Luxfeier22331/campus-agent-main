# hub-web

Cloudflare Worker-hosted product entry surface for the campus-agent app set.

It owns:

- `hub.muc.wiki/[slug]` app launcher routes
- `/account` browser shell for login, registration and password recovery
- allowlisted same-site seams to `apps/app-api` through Worker `APP_API`
  Service Binding
- external legacy Wiki card pointing to `https://muc.wiki`

It does not own:

- auth database, session storage, principal mapping or authorization truth
- generic `/api/*` proxy behavior
- MediaWiki content, uploaded media, account migration, proxying or mirroring
- supervisor execution or agent routing

Current route scope:

- `GET /healthz`
- `GET /readyz`
- `GET /`
- `GET /account`
- `GET /account/login`
- `GET /account/register`
- `GET /account/forgot-password`
- `GET /account/reset-password`
- `GET /chat`
- `GET /docs`
- `GET /map`
- `GET /services`
- `GET /notices`
- `GET /panel`

Allowlisted app-api seams:

- `GET /api/me`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-out`
- `GET /api/auth/get-session`
- `POST /api/auth/request-password-reset`
- `POST /api/auth/reset-password`

Unknown `/api/*` paths fail closed.

Environment:

- `APP_API_BASE_URL`
- `HUB_WEB_HOSTNAME`
- `AUTH_TURNSTILE_SITE_KEY`
- `AUTH_TURNSTILE_APPEARANCE`
- `AUTH_TURNSTILE_EXECUTION`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`

The Worker also requires an internal `APP_API` service binding at runtime.

Staging deployment keeps Turnstile widget values out of tracked `wrangler.toml`.
Use `STAGING_HUB_AUTH_TURNSTILE_SITE_KEY` plus optional
`STAGING_HUB_AUTH_TURNSTILE_APPEARANCE` and
`STAGING_HUB_AUTH_TURNSTILE_EXECUTION` when deploying staging.

Local commands:

```bash
pnpm install
pnpm build
pnpm test
pnpm test:worker
pnpm typecheck
pnpm dev
```

`pnpm dev` listens on `<http://127.0.0.1:27012/>`. The hub surface does not use
Vite's default `5173` port; that port is already reserved by other local Worker
smoke flows.
