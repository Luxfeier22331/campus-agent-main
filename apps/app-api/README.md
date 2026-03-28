# app-api

Shared Worker-native application backend for campus-agent v2.

This directory currently contains two aligned artifacts:

- the Worker app that serves auth/chat/operator APIs for `public-chat-web` and `protected-panel-web`
- the companion Python package `campus_app_api`, used for typed context projection helpers on the Python-side execution path

This app is the shared product backend behind:

- `apps/public-chat-web`
- `apps/protected-panel-web`

It owns:

- auth and session handling
- product-layer principal mapping
- chat request ingress
- conversation and message persistence
- `runtime.request_execution` and `runtime.projection_outbox`
- `operator.request_projection` list/detail APIs
- explicit `app-api -> supervisor-api` execution calls

It does not own:

- browser-facing UI shells
- supervisor routing or specialist orchestration
- panel business actions

Current runtime scope:

- `GET /healthz`
- `GET /readyz`
- `ALL /api/auth/*`
- `GET /api/me`
- `POST /api/chat/requests`
- `GET /api/operator/requests`
- `GET /api/operator/requests/:requestId`
- scheduled request-projection projector

Runtime hardening baseline:

- `GET /readyz` now fails closed unless database binding, Better Auth origin, operator allowlist, internal bridge secret, and supervisor config are all present
- auth responses, chat responses, and operator query responses default to `Cache-Control: no-store`
- Better Auth keeps origin / CSRF checks enabled and turns on production rate limiting
- the protected panel operator bridge is accepted only when allowlisted operator headers arrive with a matching internal shared secret
- `app-api -> supervisor-api` uses a bounded timeout budget and typed invalid-response handling
- the request projector now retries with backoff and marks exhausted events terminally instead of spinning forever

Canonical references:

- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/request-projection-and-runtime-read-model.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/data/app-api-schema.md`

Database baseline:

- runtime reads/writes use Hyperdrive-style runtime connection config
- migration / schema management uses `APP_API_MANAGEMENT_DATABASE_URL`
- Drizzle schema and Better Auth tables share one migration pipeline

Environment:

- `APP_API_NAME`
- `APP_API_ENVIRONMENT`
- `APP_API_DB.connectionString`
- `BETTER_AUTH_SECRET`
- `PUBLIC_CHAT_WEB_ORIGIN`
- `SUPERVISOR_API_BASE_URL`
- `SUPERVISOR_API_SHARED_SECRET`
- `SUPERVISOR_API_TIMEOUT_MS`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST`
- `APP_API_INTERNAL_SHARED_SECRET`
- `APP_API_MANAGEMENT_DATABASE_URL`
- `APP_API_DATABASE_SSLMODE`

Local commands:

```bash
pnpm test
pnpm typecheck
pnpm db:generate
pnpm db:migrate
pnpm dev
```
