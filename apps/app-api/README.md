# app-api

Shared Worker-native application backend for campus-agent v2.

This directory currently contains two aligned artifacts:

- the Worker app that serves auth/chat/operator APIs for `campus-web` and
  `operator-console-web`
- the companion Python package `campus_app_api`, used for typed context
  projection helpers on the Python-side execution path

This app is the shared product backend behind:

- `apps/campus-web`
- `apps/operator-console-web`

It owns:

- auth and session handling
- the neutral Identity Platform product boundary for account, identity, access,
  preferences and federation policy
- product-layer principal mapping
- chat request ingress
- conversation and message persistence
- answer quality feedback persistence
- `official_web` collector admission, crawl-run ledger, artifact refs, and
  ingestion handoff dispatch
- `runtime.request_execution` and `runtime.projection_outbox`
- `operator.request_projection` list/detail APIs
- `operator.official_web_*` site/run/detail APIs
- explicit `app-api -> execution-control` workflow command calls
- `docs.*` read model import/export for the document reader surface

It does not own:

- browser-facing UI shells
- execution routing or agent orchestration
- panel business actions

Current runtime scope:

- `GET /healthz`
- `GET /readyz`
- `ALL /api/auth/*`
  - includes email/password sign-up, sign-in, request-password-reset, and
    reset-password
- `GET /api/me`
  - compact current session principal projection
- `GET /.well-known/openid-configuration`
- `GET /.well-known/oauth-authorization-server`
- `GET /api/federation/authorize`
- `POST /api/federation/token`
- `GET /api/federation/userinfo`
- `GET /api/federation/jwks`
- `GET /api/federation/logout`
- `POST /api/official-web/runs`
- `POST /api/official-web/runs/:runId/heartbeats`
- `POST /api/official-web/runs/:runId/finalize`
- `POST /api/chat/requests`
- `POST /api/chat/requests/stream`
- `GET /api/chat/runs/:runId/steps`
- `PUT /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- `DELETE /api/chat/conversations/:conversationId/messages/:messageId/feedback`
- `GET /api/operator/requests`
- `GET /api/operator/requests/:requestId`
- `GET /api/operator/official-web/sites`
- `GET /api/operator/official-web/sites/:siteId`
- `GET /api/operator/official-web/runs`
- `GET /api/operator/official-web/runs/:runId`
- `POST /api/internal/staging-smoke/auth/session` (`staging` only)
- optional scheduled request-projection projector
- optional scheduled `official_web` projection + handoff dispatcher

Runtime hardening baseline:

- `GET /readyz` now fails closed unless database binding, Better Auth origin,
  operator allowlist, internal trusted caller secret, and execution-control
  config are all present
- end-user Better Auth email/password sign-up and sign-in are admitted only for
  configured campus email domain suffixes plus optional exact-email exceptions
- `GET /readyz` also reports whether the optional `official_web` ingestion
  handoff runtime is configured
- auth responses, chat responses, and operator query responses set
  `Cache-Control: no-store`
- Better Auth keeps origin / CSRF checks enabled and turns on production rate
  limiting
- the Operator Console operator surface is accepted only when allowlisted operator
  headers arrive with a matching internal shared secret
- `app-api -> execution-control` uses a bounded timeout budget and typed
  invalid-response handling
- successful chat/eval request ingress now opportunistically triggers a bounded
  request-projection drain via Worker `waitUntil`; scheduled DB sweepers are
  disabled by default and only run when their explicit `APP_API_*_SWEEPER_ENABLED`
  env gate is set to `true`
- the request projector now retries with backoff and marks exhausted events
  terminally instead of spinning forever
- the `official_web` projector now dispatches terminal run handoff payloads
  before marking outbox events processed, and it projects `queued` /
  `dispatched` / `ingestion_failed` explicitly for panel consumers
- Worker `fetch` and `scheduled` are wrapped by Sentry; `app-api` is the primary
  observability owner for this product topology
- `app-api` emits minimal runtime lifecycle telemetry through the controlled
  OTLP ingest endpoint; the Collector fans accepted telemetry out to Axiom,
  Sentry and Langfuse according to `infra/otel`
- trace propagation keeps canonical `x-trace-id` and also forwards
  `sentry-trace` / `baggage` across `campus-web -> app-api ->
  execution-control` and `operator-console-web -> app-api`
- observability sinks are never the panel request truth source;
  `operator.request_projection` remains canonical
- operator runtime pressure APIs read bounded current projections by default;
  Temporal task queue and autoscaler history rows are written only by explicit
  proof ingestion, not by default staging runtime loops

Observability data policy:

- allowed sink fields are correlation and governance summaries such as
  `request_id`, `trace_id`, `conversation_id`, `surface`, `status`,
  `selected_tool`, `requested_tool`, `requested_scope_summary`,
  `duration_ms`, and source-doc count/summary
- forbidden fields include raw JWT/auth headers, cookies, raw prompt/question,
  raw answer, operator email, transcript text, and long-term memory text
- deployed `app-api` telemetry requires `APP_API_OTEL_INGEST_ENDPOINT` and
  `APP_API_OTEL_INGEST_SHARED_SECRET`; missing values fail closed instead of
  falling back to direct Axiom REST ingest
- direct Axiom REST ingest is not an app-api runtime surface; Axiom exporter
  credentials belong to the Collector deployment
- Operator Console trace / issue links are app-owned projections, not route-time
  sink queries. Configure optional `APP_API_OPERATOR_TRACE_LINK_TEMPLATE` and
  `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE` when Operator Console should show
  Sentry / Axiom deep links for request diagnostics. Supported placeholders are
  `{requestId}`, `{traceId}`, `{errorCode}`, `{selectedTool}`, `{surface}`,
  and `{status}`; values are URL-encoded before rendering.

Canonical references:

- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0016-app-api-request-projection-and-operator-console-query-ownership.md`
- `docs/decisions/adr-0045-identity-platform-and-auth-runtime-boundary.md`
- `docs/architecture/system/identity-platform-architecture.md`
- `docs/architecture/system/identity-browser-experience-architecture.md`
- `docs/architecture/system/federation-and-mucwiki-login-architecture.md`
- `docs/contracts/app-api-identity-platform-http.md`
- `docs/contracts/app-api-federation-http.md`
- `docs/data/identity-platform-schema.md`
- `docs/decisions/adr-0017-executionClient-internal-execution-admission.md`
- `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`
- `docs/contracts/app-api-http.md`
- `docs/contracts/app-api-official-web-http.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/contracts/tool-execution.md`
- `docs/contracts/app-api-request-lifecycle.md`
- `docs/data/app-api-schema.md`
- `docs/data/app-api-official-web-schema.md`

Database baseline:

- runtime reads/writes use Hyperdrive-style runtime connection config against
  the shared repo Postgres
- runtime now distinguishes `APP_API_DB` for cached/read-mostly access and
  optional `APP_API_DB_FRESH` for explicit no-cache read-after-write access
- `APP_API_DURABLE_CLOSEOUT_SWEEPER_ENABLED`,
  `APP_API_REQUEST_PROJECTION_SWEEPER_ENABLED`, and
  `APP_API_OFFICIAL_WEB_PROJECTION_SWEEPER_ENABLED` default to disabled; set
  exactly `true` only for a deliberate scheduled drain lane
- migration / schema management uses canonical `APP_API_OPERATOR_DATABASE_URL`
- `apps/app-api` runtime schema code continues to cover `app_auth.*`, `chat.*`,
  `runtime.*`, `operator.*`, `official_web.*`, and `profile.*`
- `drizzle.app_api_migrations` now owns only `runtime.*`, `operator.*`, and
  `official_web.*` / `profile.*`
- Better Auth uses repo-owned `app_auth.*`; `apps/app-api` is now the shared-db
  bootstrap owner for `app_auth.*` / `chat.*`
- Better Auth runtime now uses the shared Drizzle/runtime DB seam with explicit
  `app_auth.*` schema metadata instead of a dedicated auth-only `pg.Pool`
- when `APP_API_DB_FRESH` is provisioned, Better Auth plus the explicitly
  whitelisted dining operations, provider configuration write paths, chat
  command conversation-context admission, and chat conversation detail
  read-after-write verification path use the no-cache Hyperdrive lane. Chat
  request writes, runtime projection, operator observability, profile memory,
  official-web command projection, wechat command projection, campus-services
  ops, and identity platform projection use the default `APP_API_DB` lane unless
  they are deliberately reclassified with a contract test.
- `APP_API_DB_FRESH` is not a second database. It points at the same shared
  Postgres through a caching-disabled Hyperdrive config so `sign-up ->
  immediate sign-in` and other explicitly admitted read-after-write flows do
  not get trapped behind stale negative cache lookups.
- on the current Supabase session pooler, role-level `search_path=app_auth,
  public, extensions` remains a shared-product bootstrap convention, but runtime
  auth no longer depends on connection-string `options=-c search_path=...`
- deployed Worker envs (`staging` / `production`) cache the static Worker/app
  assembly again, but runtime DB handles and Better Auth state are now rebuilt
  per request scope instead of being held across invocations; only the `test`
  harness keeps global runtime caches
- `app-api` stores migration journal rows in `drizzle.app_api_migrations`, not
  the default shared Drizzle table

Environment:

- `apps/app-api/.env` for local Wrangler / Drizzle process env
- `apps/app-api/.dev.vars` for local Worker string env consumed by runtime and
  shared-product bootstrap commands
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
- `AUTH_SHELL_ORIGIN`
- `APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST`
- `APP_API_END_USER_EMAIL_ALLOWLIST`
- `EXECUTION_CONTROL_BASE_URL`
- `EXECUTION_CONTROL_SHARED_SECRET`
- `EXECUTION_CONTROL_TIMEOUT_MS`
- `EXECUTION_CONTROL_EVAL_TIMEOUT_MS`
- `APP_API_OPERATOR_EMAIL_ALLOWLIST`
- `APP_API_OPERATOR_TRACE_LINK_TEMPLATE`
- `APP_API_OPERATOR_ISSUE_LINK_TEMPLATE`
- `APP_API_INTERNAL_SHARED_SECRET`
- `APP_API_STAGING_SMOKE_AUTH_SECRET`
- `APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET`
- `APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI`
- `APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI`
- `APP_API_OPERATOR_DATABASE_URL`
- `APP_API_DATABASE_SSLMODE`
- `OBJECT_STORE_ENDPOINT`
- `OBJECT_STORE_REGION`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`
- `OBJECT_STORE_DERIVED_ACCESS_KEY`
- `OBJECT_STORE_DERIVED_SECRET_KEY`
- `OBJECT_STORE_BUCKET_DERIVED`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `APP_API_OTEL_INGEST_ENDPOINT`
- `APP_API_OTEL_INGEST_SHARED_SECRET`

Local development:

- `pnpm dev` runs `wrangler dev -e local --ip 127.0.0.1 --port 27031`
- the local Worker runtime expects the `APP_API_DB` Hyperdrive binding from
  `wrangler.toml` `env.local`
- put local Wrangler / Drizzle process env in `apps/app-api/.env`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=...`
  - `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=...`
  - `APP_API_OPERATOR_DATABASE_URL=...`
- if the root worktree `.env` already has `CAMPUS_SHARED_POSTGRES_URL`, use `uv
  run --all-packages python -m scripts.sync_app_api_local_db_env --repo-root
  <current-worktree-root>` to generate `apps/app-api/.env`; the sync script will
  mirror the runtime DSN into both `APP_API_DB` and `APP_API_DB_FRESH` local
  bindings unless you later override them manually
- put Worker string env in `apps/app-api/.dev.vars`
- for `official_web` live control-plane smoke,
  `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` must be non-empty and must match
  `apps/official-web-collector/.env` `OFFICIAL_WEB_SERVICE_TOKEN`
- if current staging only targets `app-api + campus-web + operator-console-web`,
  and does not yet enable official-web live control-plane,
  `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` is optional for that rollout
- dining floorplan upload and `seed-initial-dining-release.ts` use the configured
  S3-compatible derived bucket. Local dev normally points `OBJECT_STORE_*` at
  MinIO; staging/prod can point the same env shape at R2/S3-compatible storage.
  Missing object-store config fails closed for dining SVG upload and seed.

Deployment minimum gate:

- `APP_API_DB.connectionString` must resolve from the provisioned Worker
  `APP_API_DB` binding or `GET /readyz` remains `503`
- `APP_API_DB_FRESH.connectionString` should resolve from a caching-disabled
  Hyperdrive binding in deployed envs so explicitly admitted auth /
  provider-config / dining read-after-write paths stay fresh
- `AUTH_SHELL_ORIGIN` must point at the deployed `campus-web` account browser
  shell
- `AUTH_TURNSTILE_SECRET_KEY` must be present or the captcha-gated sign-in /
  sign-up / request-password-reset surface remains not ready
- `RESEND_API_KEY` and `AUTH_RESET_EMAIL_FROM` must both be present or password
  reset remains fail-closed at config/readiness level
- `AUTH_RESET_EMAIL_FROM` must be a sender identity admitted by the currently
  selected transactional mail provider; `AUTH_RESET_EMAIL_REPLY_TO` is optional
- `APP_API_SAFETY_IDENTIFIER_HMAC_SECRET` must be present whenever end-user
  safety traceability is enabled; it must be distinct from `BETTER_AUTH_SECRET`
  and `APP_API_INTERNAL_SHARED_SECRET`
- `APP_API_END_USER_EMAIL_DOMAIN_ALLOWLIST` must contain the admitted campus
  email suffixes for end-user auth; `APP_API_END_USER_EMAIL_ALLOWLIST` is
  optional for explicit exceptions
- `APP_API_INTERNAL_SHARED_SECRET` must exactly match
  `OPERATOR_CONSOLE_APP_API_SHARED_SECRET` in `apps/operator-console-web`
- `APP_API_STAGING_SMOKE_AUTH_SECRET` is required only for staging authenticated
  smoke automation; it gates
  `POST /api/internal/staging-smoke/auth/session`, must be distinct from the
  public auth and internal service secrets, and must be provided through the
  ops-owned staging runtime env file or `STAGING_RUNTIME_ENV_FILE`
- `APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET`,
  `APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI` and
  `APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI` are required only when
  provisioning the controlled `muc-wiki` OAuth/OIDC client. The client secret
  is command-scoped secret material; it is not a Worker runtime variable and
  must not be committed.
- `APP_API_OPERATOR_EMAIL_ALLOWLIST` must contain the real operator emails
  expected to use the Operator Console trusted caller
- `EXECUTION_CONTROL_BASE_URL` and `EXECUTION_CONTROL_SHARED_SECRET` must be present
  together; partial configuration does not produce a ready runtime
- `EXECUTION_CONTROL_ACCESS_CLIENT_ID` and
  `EXECUTION_CONTROL_ACCESS_CLIENT_SECRET` are optional, and are sent only when
  the execution-control machine ingress is
  protected by Cloudflare Access service-token authentication
- password reset callback is frozen to `AUTH_SHELL_ORIGIN`
  `/account/reset-password`; the Better Auth token URL remains under the
  same-site app-api auth endpoint and carries that callback URL.

Local commands:

```bash
uv run --all-packages python -m scripts.sync_app_api_local_db_env
node ./scripts/run-with-local-env.mjs node \
  ./scripts/print-shared-product-auth-migration.mjs
node ./scripts/run-with-local-env.mjs node \
  ./scripts/ensure-app-auth-role-search-path.mjs
node ./scripts/run-with-local-env.mjs node \
  ./scripts/bootstrap-shared-product-with-seeds.mjs
node ./scripts/run-with-local-env.mjs node \
  ./scripts/adopt-shared-database.mjs --json
node ./scripts/run-with-local-env.mjs node \
  ./scripts/reconcile-shared-db-drift.mjs --json
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' \
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/provision-smoke-identity.ts \
  --email help_bot@outlook.com --name "Help Bot"
APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET='<secret>' \
APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:PluggableAuthLogin' \
APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:UserLogout' \
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/provision-muc-wiki-federation-client.ts
pnpm chat:e2e:dev -- --prompt "中央民族大学本科学生国家奖学金评审办法"
pnpm chat:e2e:local-real-provider
pnpm chat:e2e:staging -- --prompt "中央民族大学本科学生国家奖学金评审办法"
pnpm chat:memory:e2e:staging
pnpm runtime-db:proof:staging
node ./scripts/run-with-staging-smoke-env.mjs pnpm exec tsx \
  ./scripts/staging-docs-gated-smoke.ts
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/drain-official-web-projection.ts --limit 50
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/collection-rename-backfill.ts audit
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/collection-rename-backfill.ts apply \
  --write-report .tmp/collection-rename-apply.json
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/collection-rename-backfill.ts replay-projections \
  --report .tmp/collection-rename-apply.json
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/import-docs-read-model.ts ../../var/docs-read-model-manifest.json
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/export-public-docs-sync-manifest.ts \
  ../../var/public-docs-sync-manifest.json
node ./scripts/run-with-local-env.mjs pnpm exec tsx \
  ./scripts/seed-initial-dining-release.ts
node ./scripts/run-with-local-env.mjs node \
  ./scripts/trigger-local-scheduled-drain.mjs
pnpm test
pnpm test:all
pnpm test:node
pnpm test:worker
pnpm test:shared-db-integration
pnpm test:official-web-shared-db-integration
pnpm typecheck
node ./scripts/run-with-local-env.mjs drizzle-kit generate
node ./scripts/run-with-local-env.mjs drizzle-kit migrate
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
  node ./scripts/run-with-staging-db-env.mjs node \
  ./scripts/bootstrap-shared-product-with-seeds.mjs
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
  node ./scripts/run-with-staging-db-env.mjs pnpm exec drizzle-kit migrate
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
  node ./scripts/run-with-staging-db-env.mjs node \
  ./scripts/reconcile-shared-db-drift.mjs --json
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
  node ./scripts/run-with-staging-db-env.mjs pnpm exec tsx \
  ./scripts/import-docs-read-model.ts ../../var/docs-read-model-manifest.json
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
  node ./scripts/run-with-staging-db-env.mjs pnpm exec tsx \
  ./scripts/export-public-docs-sync-manifest.ts \
  ../../var/public-docs-sync-manifest.staging.json
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
  node ./scripts/run-with-staging-db-env.mjs pnpm exec tsx \
  ./scripts/seed-initial-dining-release.ts
APP_API_SMOKE_IDENTITY_PASSWORD='<secret>' \
  STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
  node ./scripts/run-with-staging-db-env.mjs pnpm exec tsx \
  ./scripts/provision-smoke-identity.ts \
  --email help_bot@outlook.com --name \
  "Help Bot"
APP_API_FEDERATION_MUC_WIKI_CLIENT_SECRET='<secret>' \
APP_API_FEDERATION_MUC_WIKI_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:PluggableAuthLogin' \
APP_API_FEDERATION_MUC_WIKI_POST_LOGOUT_REDIRECT_URI='https://muc.wiki/wiki/'\
'Special:UserLogout' \
STAGING_APP_API_OPERATOR_DATABASE_URL=postgresql://<staging-operator-url> \
node ./scripts/run-with-staging-db-env.mjs pnpm exec tsx \
  ./scripts/provision-muc-wiki-federation-client.ts
pnpm chat:e2e:staging -- --prompt "中央民族大学本科学生国家奖学金评审办法"
pnpm runtime-db:proof:staging
node ./scripts/run-with-staging-smoke-env.mjs pnpm exec tsx \
  ./scripts/staging-docs-gated-smoke.ts
pnpm dev
```

Deploy note:

- `pnpm deploy:staging` 只发布 Worker，不会替你迁移 shared Postgres
- docs seed handoff 的 app-api 入口是 `import-docs-read-model.ts` 与
  `export-public-docs-sync-manifest.ts`。它们消费已发布的 reader/read-model artifact，
  不运行采集器，也不扫描对象存储决定文档范围。
- 在任何 staging `official_web` / operator surface smoke 之前，先执行
  `run-with-staging-db-env.mjs` 包裹的 bootstrap、migrate 与
  `reconcile-shared-db-drift.mjs --json`
- `runtime-db:proof:staging` 使用 `run-with-staging-proof-env.mjs`，由 runner
  读取 staging profile env 并投影 canonical app-api env；proof 脚本本身不消费
  `STAGING_APP_API_OPERATOR_DATABASE_URL`。该 proof 会立刻读取 conversation detail
  验证 assistant answer 已落盘，因此该 detail read-after-write 路径必须走
  `APP_API_DB_FRESH`。
- 否则 `official_web` 投影表一旦落后于 repo schema，`/api/operator/official-web/sites` 与
  `/api/operator/official-web/runs` 会一起退化成 `internal_error`
- `bootstrap-shared-product-with-seeds.mjs` 负责补齐 `app_auth.*` /
  `chat.*` shared-product 面；现有 staging 若只跑 migrate，不会自动得到
  `chat.messages.structured_parts_json`
- `seed-initial-dining-release.ts` writes the initial dining DB release and
  materializes seed SVG objects into `OBJECT_STORE_BUCKET_DERIVED`; run it only
  with the intended dev/staging/prod DB and object-store env.
- `provision-muc-wiki-federation-client.ts` 负责把 controlled `muc-wiki` client
  同步到 `identity.federation_*` product policy 与 Better Auth
  `app_auth.oauthClient` runtime table。它必须在 staging DB bootstrap/migrate/drift
  之后、MediaWiki OIDC smoke 之前执行。
- `chat:e2e:staging`, `chat:memory:e2e:staging`, and
  `docs:gated:smoke:staging` do not require local staging DB credentials; they
  reset the fixed smoke identity through the deployed staging internal smoke
  endpoint protected by `APP_API_STAGING_SMOKE_AUTH_SECRET`
- `chat:e2e:staging` defaults to the durable submit + run-event resume smoke:
  it reads `request.accepted` from `/api/chat/requests/stream`, then verifies
  `/api/chat/runs/:runId/events/stream`, run status, steps, Langfuse closeout
  identity, and conversation materialization. The generic `chat:e2e -- --profile
  staging` runner remains a diagnostic path, not the release gate.
- `chat:memory:e2e:staging` writes an explicit profile-memory item, submits a
  stream chat request, reads `/api/chat/runs/:runId/steps`, and verifies the
  sanitized `memory.recall` projection before deleting the temporary memory.
- `chat:e2e:dev` is the local chat wrapper. It starts the local execution
  runtime, runs shared-product bootstrap directly, provisions the smoke identity,
  starts or reuses the campus-web dev surface, and then runs
  `chat:e2e -- --profile dev`.

Testing lanes:

- `pnpm test` and `pnpm test:node` are the stable default gate for `app-api`
  business logic and contract tests under the Node runtime.
- `pnpm test:all` fans out the local non-DB Vitest projects (`node` + `worker`)
  from a single app-owned entrypoint.
- `pnpm test:worker` is the explicit Worker-runtime lane for the shared
  `app-api` shell and readiness contract.
- `pnpm test:shared-db-integration` is the explicit shared Postgres / Better
  Auth integration lane and is not part of the default `pnpm test` gate. It
  does not require `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN`.
- `pnpm test:shared-db-integration` also fails closed when the connected shared
  DB no longer converges with the repo-owned `official_web/runtime/operator`
  snapshot.
- `pnpm test:official-web-shared-db-integration` is the explicit
  `official_web` collector lifecycle lane. It requires
  `APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN` and is only part of rollout/smoke when
  the official-web collector control plane is in scope.
- When shared DB drift is detected, inspect it with
  `node ./scripts/run-with-local-env.mjs node
  ./scripts/reconcile-shared-db-drift.mjs --json`
  before applying cleanup with backup and `--apply`.
- `trigger-local-scheduled-drain.mjs` hits the repo-local Worker scheduled test
  route (`/cdn-cgi/handler/scheduled`), so local dev should be running with
  `pnpm dev - - --test-scheduled` or an equivalent Wrangler flag before using it.
