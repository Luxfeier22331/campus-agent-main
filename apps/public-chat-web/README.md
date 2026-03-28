# public-chat-web

Cloudflare Worker runtime shell for the public chat web surface.

This app is the forward canonical public browser surface in front of shared `apps/app-api`.

It currently owns only:

- public route shell
- same-site `/api/*` proxy seam into `apps/app-api`
- minimal health/readiness contract

It does not own:

- auth/session/conversation truth
- chat request ledger or request projection truth
- direct browser access to `apps/supervisor-api`

Current shell scope:

- `GET /healthz`
- `GET /readyz`
- `GET /`
- `ALL /api/*`

The root route intentionally remains a placeholder until the forward public UI shell is mounted here. This worker already provides the canonical same-site API seam to `app-api`, so future UI migration does not need to reopen backend ownership.

Canonical references:

- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/cloudflare-runtime-topology.md`
- `docs/contracts/app-api-http.md`
- `docs/decisions/adr-0012-shared-app-api-and-worker-web-surfaces.md`
- `docs/decisions/adr-0013-app-api-worker-runtime.md`
- `docs/decisions/adr-0015-supervisor-internal-execution-admission.md`

Historical reference:

- `apps/public-consumer-chat`

Environment:

- `PUBLIC_CHAT_APP_NAME`
- `PUBLIC_CHAT_HOSTNAME`
- `APP_API_BASE_URL`

The Worker also requires an internal `APP_API` service binding at runtime.

Local commands:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev
```
