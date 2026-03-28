# app-api

Shared Worker-native application backend for campus-agent v2.

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

Canonical references:

- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/request-projection-and-runtime-read-model.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/data/app-api-schema.md`

Database baseline:

- runtime reads/writes use Hyperdrive-style runtime connection config
- migration / schema management uses `APP_API_MANAGEMENT_DATABASE_URL`
- Drizzle schema and Better Auth tables share one migration pipeline

Local commands:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm db:generate
pnpm db:migrate
pnpm dev
```
