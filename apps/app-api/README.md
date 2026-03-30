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
- `official_web` collector admission, crawl-run ledger, artifact refs, and ingestion handoff dispatch
- `runtime.request_execution` and `runtime.projection_outbox`
- `operator.request_projection` list/detail APIs
- `operator.official_web_*` site/run/detail APIs
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
- `POST /api/official-web/runs`
- `POST /api/official-web/runs/:runId/heartbeats`
- `POST /api/official-web/runs/:runId/finalize`
- `POST /api/chat/requests`
- `GET /api/operator/requests`
- `GET /api/operator/requests/:requestId`
- `GET /api/operator/official-web/sites`
- `GET /api/operator/official-web/sites/:siteId`
- `GET /api/operator/official-web/runs`
- `GET /api/operator/official-web/runs/:runId`
- scheduled request-projection projector
- scheduled `official_web` projection + handoff dispatcher

Runtime hardening baseline:

- `GET /readyz` now fails closed unless database binding, Better Auth origin, operator allowlist, internal bridge secret, and supervisor config are all present
- `GET /readyz` also reports whether the optional `official_web` ingestion handoff runtime is configured
- auth responses, chat responses, and operator query responses default to `Cache-Control: no-store`
- Better Auth keeps origin / CSRF checks enabled and turns on production rate limiting
- the protected panel operator bridge is accepted only when allowlisted operator headers arrive with a matching internal shared secret
- `app-api -> supervisor-api` uses a bounded timeout budget and typed invalid-response handling
- the request projector now retries with backoff and marks exhausted events terminally instead of spinning forever
- the `official_web` projector now dispatches terminal run handoff payloads before marking outbox events processed, and it projects `queued` / `dispatched` / `ingestion_failed` explicitly for panel consumers
- Worker `fetch` and `scheduled` are wrapped by Sentry; `app-api` is the primary observability owner for this product topology
- `app-api` emits minimal Axiom runtime events for `request.accepted`, `request.finalized`, `request.transport_error`, `projection.enqueued`, and `projection.drain`
- trace propagation keeps canonical `x-trace-id` and also forwards `sentry-trace` / `baggage` across `public-chat-web -> app-api -> supervisor-api` and `protected-panel-web -> app-api`
- observability sinks are never the panel request truth source; `operator.request_projection` remains canonical

Observability data policy:

- allowed sink fields are correlation and governance summaries such as `request_id`, `trace_id`, `conversation_id`, `surface`, `status`, `selected_target`, `requested_capability`, `requested_scope_summary`, `duration_ms`, and source-doc count/summary
- forbidden fields include raw JWT/auth headers, cookies, raw prompt/question, raw answer, operator email, transcript text, and long-term memory text
- the current Axiom integration is an interim Worker-local REST adapter; the long-term architecture still targets `OTel -> Collector -> sink`
- `AXIOM_ENDPOINT` should normally be the base domain of the org edge deployment shown in Axiom `Settings -> General -> Edge deployment`, for example `https://us-east-1.aws.edge.axiom.co`
- `app-api` uses the edge ingest route for `*.edge.axiom.co` endpoints and the dataset ingest route for the shared `https://api.axiom.co` domain
- `AXIOM_DATASET` should stay service- and environment-scoped, for example `campus-agent-runtime-dev`
- when `AXIOM_ENDPOINT` points at an edge deployment domain, `AXIOM_TOKEN` must be an Axiom API token rather than a PAT

Canonical references:

- `docs/architecture/shared-app-api-and-worker-web-surfaces.md`
- `docs/architecture/app-api-architecture.md`
- `docs/architecture/official-web-control-plane-on-app-api.md`
- `docs/architecture/request-projection-and-runtime-read-model.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-panel-query-ownership.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-official-web-http.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/data/app-api-schema.md`
- `docs/data/app-api-official-web-schema.md`

Database baseline:

- runtime reads/writes use Hyperdrive-style runtime connection config against the shared repo Postgres
- migration / schema management uses `APP_API_MANAGEMENT_DATABASE_URL`
- Drizzle schema and Better Auth tables share one `app-api` migration pipeline on the shared repo Postgres
- `app-api` stores migration journal rows in `drizzle.app_api_migrations`, not the default shared Drizzle table

Environment:

- `apps/app-api/.env` for local Wrangler / Drizzle process env
- `APP_API_NAME`
- `APP_API_ENVIRONMENT`
- `APP_API_DB.connectionString`
- `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN`
- `APP_API_OFFICIAL_WEB_HANDOFF_URL`
- `APP_API_OFFICIAL_WEB_HANDOFF_TOKEN`
- `APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS`
- `BETTER_AUTH_SECRET`
- `PUBLIC_CHAT_WEB_ORIGIN`
- `SUPERVISOR_API_BASE_URL`
- `SUPERVISOR_API_SHARED_SECRET`
- `SUPERVISOR_API_TIMEOUT_MS`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST`
- `APP_API_INTERNAL_SHARED_SECRET`
- `APP_API_MANAGEMENT_DATABASE_URL`
- `APP_API_DATABASE_SSLMODE`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `AXIOM_ENDPOINT`
- `AXIOM_DATASET`
- `AXIOM_TOKEN`

Local commands:

```bash
uv run --all-packages python -m scripts.sync_app_api_local_db_env
pnpm db:adopt-shared -- --json
pnpm test
pnpm typecheck
pnpm db:generate
pnpm db:migrate
pnpm dev
```
