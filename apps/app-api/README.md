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
  - includes email/password sign-up, sign-in, request-password-reset, and reset-password
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
- end-user Better Auth email/password sign-up and sign-in are admitted only for configured campus email domain suffixes plus optional exact-email exceptions
- `GET /readyz` also reports whether the optional `official_web` ingestion handoff runtime is configured
- auth responses, chat responses, and operator query responses default to `Cache-Control: no-store`
- Better Auth keeps origin / CSRF checks enabled and turns on production rate limiting
- the protected panel operator bridge is accepted only when allowlisted operator headers arrive with a matching internal shared secret
- `app-api -> supervisor-api` uses a bounded timeout budget and typed invalid-response handling
- successful chat/eval request ingress now opportunistically triggers a bounded request-projection drain via Worker `waitUntil`; scheduled drain remains the recovery/backstop path
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

- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/architecture/official-web-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
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
- runtime now distinguishes `APP_API_DB` for cached/read-mostly access and optional `APP_API_DB_FRESH` for auth/fresh read-after-write access
- migration / schema management uses canonical `APP_API_OPERATOR_DATABASE_URL`
  with legacy `APP_API_MANAGEMENT_DATABASE_URL` kept as a compatibility alias
- `apps/app-api` runtime schema code continues to cover `app_auth.*`, `chat.*`, `runtime.*`, `operator.*`, and `official_web.*`
- `drizzle.app_api_migrations` now owns only `runtime.*`, `operator.*`, and `official_web.*`
- Better Auth uses repo-owned `app_auth.*`; `apps/app-api` is now the shared-db bootstrap owner for `app_auth.*` / `chat.*`
- Better Auth runtime now uses the shared Drizzle/runtime DB seam with explicit `app_auth.*` schema metadata instead of a dedicated auth-only `pg.Pool`
- when `APP_API_DB_FRESH` is provisioned, Better Auth and request-scoped command-side services read/write through the no-cache Hyperdrive lane so `sign-up -> immediate sign-in` does not get trapped behind stale negative auth lookups
- on the current Supabase session pooler, role-level `search_path=app_auth, public, extensions` remains a shared-product bootstrap convention, but runtime auth no longer depends on connection-string `options=-c search_path=...`
- deployed Worker envs (`staging` / `production`) cache the static Worker/app assembly again, but runtime DB handles and Better Auth state are now rebuilt per request scope instead of being held across invocations; only the `test` harness keeps global runtime caches
- `app-api` stores migration journal rows in `drizzle.app_api_migrations`, not the default shared Drizzle table

Environment:

- `apps/app-api/.env` for local Wrangler / Drizzle process env
- `apps/app-api/.dev.vars` for local Worker string env consumed by runtime and shared-product bootstrap commands
- `APP_API_NAME`
- `APP_API_ENVIRONMENT`
- `APP_API_DB.connectionString`
- `APP_API_DB_FRESH.connectionString`
- `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN`
- `APP_API_OFFICIAL_WEB_HANDOFF_URL`
- `APP_API_OFFICIAL_WEB_HANDOFF_TOKEN`
- `APP_API_OFFICIAL_WEB_HANDOFF_TIMEOUT_MS`
- `BETTER_AUTH_SECRET`
- `AUTH_TURNSTILE_SECRET_KEY`
- `RESEND_API_KEY`
- `AUTH_RESET_EMAIL_FROM`
- `AUTH_RESET_EMAIL_REPLY_TO`
- `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET`
- `PUBLIC_CHAT_WEB_ORIGIN`
- `APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST`
- `APP_API_END_USER_EMAIL_ALLOWLIST`
- `SUPERVISOR_API_BASE_URL`
- `SUPERVISOR_API_SHARED_SECRET`
- `SUPERVISOR_API_TIMEOUT_MS`
- `SUPERVISOR_API_EVAL_TIMEOUT_MS`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST`
- `APP_API_INTERNAL_SHARED_SECRET`
- `APP_API_OPERATOR_DATABASE_URL`
- `APP_API_MANAGEMENT_DATABASE_URL` (legacy alias)
- `APP_API_DATABASE_SSLMODE`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `AXIOM_ENDPOINT`
- `AXIOM_DATASET`
- `AXIOM_TOKEN`

Local development:

- `pnpm dev` runs `wrangler dev -e local`
- the local Worker runtime expects the `APP_API_DB` Hyperdrive binding from `wrangler.toml` `env.local`
- put local Wrangler / Drizzle process env in `apps/app-api/.env`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=...`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=...`
  - `APP_API_OPERATOR_DATABASE_URL=...`
  - `APP_API_MANAGEMENT_DATABASE_URL=...` (legacy alias)
- if the root worktree `.env` already has `CAMPUS_SHARED_POSTGRES_URL`, use
  `uv run --all-packages python -m scripts.sync_app_api_local_db_env --repo-root <current-worktree-root>`
  to generate `apps/app-api/.env`; the sync script will mirror the runtime DSN into both
  `APP_API_DB` and `APP_API_DB_FRESH` local bindings unless you later override them manually
- put Worker string env in `apps/app-api/.dev.vars`
- for `official_web` live control-plane smoke,
  `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` must be non-empty and must match
  `apps/official-web-collector/.env` `OFFICIAL_WEB_SERVICE_TOKEN`
- if current staging only targets `app-api + public-chat-web + protected-panel-web`, and does not yet enable official-web live control-plane, `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` is optional for that rollout

Deployment minimum gate:

- `APP_API_DB.connectionString` must resolve from the provisioned Worker `APP_API_DB` binding or `GET /readyz` remains `503`
- `APP_API_DB_FRESH.connectionString` should resolve from a caching-disabled Hyperdrive binding in deployed envs so auth-sensitive read-after-write paths stay fresh
- `PUBLIC_CHAT_WEB_ORIGIN` must exactly match the deployed `public-chat-web` origin because Better Auth keeps origin / CSRF checks enabled for proxied `/api/auth/*`
- `AUTH_TURNSTILE_SECRET_KEY` must be present or the captcha-gated sign-in / sign-up / request-password-reset surface remains not ready
- `RESEND_API_KEY` and `AUTH_RESET_EMAIL_FROM` must both be present or password reset remains fail-closed at config/readiness level
- `AUTH_RESET_EMAIL_FROM` must be a sender identity admitted by the currently selected transactional mail provider; `AUTH_RESET_EMAIL_REPLY_TO` is optional
- `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET` must be present whenever end-user safety traceability is enabled; it must be distinct from `BETTER_AUTH_SECRET` and `APP_API_INTERNAL_SHARED_SECRET`
- `APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST` must contain the admitted campus email suffixes for end-user auth; `APP_API_END_USER_EMAIL_ALLOWLIST` is optional for explicit exceptions
- `APP_API_INTERNAL_SHARED_SECRET` must exactly match `PANEL_APP_API_SHARED_SECRET` in `apps/protected-panel-web`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST` must contain the real operator emails expected to use the protected panel bridge
- `SUPERVISOR_API_BASE_URL` and `SUPERVISOR_API_SHARED_SECRET` must be present together; partial configuration does not produce a ready runtime
- password reset callback is frozen to the same-site public auth family and resolves only to `PUBLIC_CHAT_WEB_ORIGIN` `/reset-password`

Local commands:

```bash
uv run --all-packages python -m scripts.sync_app_api_local_db_env
pnpm db:print-auth-migration
pnpm db:ensure-app-auth-role-search-path
pnpm db:bootstrap
pnpm db:adopt-shared -- --json
pnpm db:reconcile-shared-drift -- --json
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' pnpm smoke-identity:provision -- --email help_bot@outlook.com --name "Help Bot"
pnpm official-web:drain-projection -- --limit 50
pnpm collection-rename:audit
pnpm collection-rename:apply -- --write-report .tmp/collection-rename-apply.json
pnpm collection-rename:replay -- --report .tmp/collection-rename-apply.json
pnpm projection:drain
pnpm test
pnpm test:all
pnpm test:node
pnpm test:worker
pnpm test:shared-db-integration
pnpm typecheck
pnpm db:generate
pnpm db:migrate
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> pnpm db:bootstrap:staging
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> pnpm db:migrate:staging
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> pnpm db:reconcile-shared-drift:staging
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> pnpm smoke-identity:provision:staging -- --email help_bot@outlook.com --name "Help Bot"
pnpm dev
```

Deploy note:

- `pnpm deploy:staging` 只发布 Worker，不会替你迁移 shared Postgres
- 在任何 staging `official_web` / operator surface smoke 之前，先执行
  `STAGING_APP_API_OPERATOR_DATABASE_URL=... pnpm db:bootstrap:staging`
  `STAGING_APP_API_OPERATOR_DATABASE_URL=... pnpm db:migrate:staging`
  `STAGING_APP_API_OPERATOR_DATABASE_URL=... pnpm db:reconcile-shared-drift:staging`
- 否则 `official_web` 投影表一旦落后于 repo schema，`/api/operator/official-web/sites` 与 `/api/operator/official-web/runs` 会一起退化成 `internal_error`
- `db:bootstrap:staging` 负责补齐 `app_auth.*` / `chat.*` shared-product 面；现有 staging 若只跑 `db:migrate:staging`，不会自动得到 `chat.messages.structured_parts_json`

Testing lanes:

- `pnpm test` and `pnpm test:node` are the stable default gate for `app-api` business logic and contract tests under the Node runtime.
- `pnpm test:all` fans out the local non-DB Vitest projects (`node` + `worker`) from a single app-owned entrypoint.
- `pnpm test:worker` is the explicit Worker-runtime lane for the shared `app-api` shell and readiness contract.
- `pnpm test:shared-db-integration` is the explicit shared Postgres / Better Auth integration lane and is not part of the default `pnpm test` gate.
- `pnpm test:shared-db-integration` also fails closed when the connected shared DB no longer converges with the repo-owned `official_web/runtime/operator` snapshot.
- When shared DB drift is detected, inspect it with `pnpm db:reconcile-shared-drift -- --json` before applying cleanup with backup and `--apply`.
- `pnpm projection:drain` hits the repo-local Worker scheduled test route (`/cdn-cgi/handler/scheduled`), so local dev should be running with `pnpm dev -- --test-scheduled` or an equivalent Wrangler flag before using it.
