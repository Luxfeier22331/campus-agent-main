# app-api

Shared Cloudflare Worker backend for `campus-web` and
`operator-console-web`.

`apps/app-api` owns product ingress, auth/session handling, chat request
admission, product projections and Worker-facing operator APIs. It does not own
agent orchestration, tool execution, browser UI shells or panel business logic.

## Runtime Scope

Current public/product surfaces include:

- health and readiness: `GET /healthz`, `GET /readyz`
- Better Auth and current principal projection
- federation endpoints
- chat request submit/stream, run event/step reads and feedback writes
- operator request, observability and domain projection APIs
- dining, provider-config and campus-services operation routes
- docs reader import/export and read-model APIs

Endpoint-level wire truth belongs in `docs/contracts/app-api/`; this README is
only the app entry point.

## Data And Runtime Ownership

`app-api` owns the Worker-side product schemas for auth, chat, runtime request
observability, profile projection and related product operation surfaces.
Operator ingestion routes proxy ingestion-control's bounded projection; app-api
does not recreate source-processing lifecycle tables.

Durable schema and database ownership live in:

- `docs/data/app-api/README.md`
- `docs/data/app-api/runtime.md`
- `docs/data/app-api/operator.md`
- `docs/data/postgres-ownership.md`

`APP_API_DB` and `APP_API_DB_FRESH` are two Hyperdrive lanes to the same shared
Postgres, not two logical databases. Read-after-write-sensitive paths must be
explicitly admitted by the data owner docs.

Dining student routes read published `dining.*` projections. Dining catalog
fixture truth belongs to `packages/domains/dining`; import/review sync belongs to
`jobs/dining-sync`, not the app-api request path.

Repeatable local / staging database artifacts stay under app-owned `ops/`
entry points, `apps/app-api/drizzle/0000_initial.sql` and
`apps/app-api/db/shared-product-schema/chat_current.sql` rather than
package lifecycle scripts:

- `ops/db/bootstrap-shared-product-database.ts`
- `ops/db/ensure-app-auth-role-search-path.ts`

The shared product database includes app-api-owned `profile.*`, `runtime.*`,
`dining.*`, `docs.*`, `identity.*`, `campus_services_ops.*`, `observability.*`
and `provider_config.*` schemas. The separately managed shared-product
baselines provide `app_auth.*` and `chat.*`, as documented in
`docs/data/app-api/`.

## References

- product/runtime boundary: `docs/architecture/system/product-runtime.md`
- current accepted topology: `docs/architecture/current.md`
- identity/auth: `docs/architecture/system/identity-platform.md`
- app-api contracts: `docs/contracts/app-api/README.md`
- app-api data: `docs/data/app-api/README.md`
- operator ownership: `docs/decisions/adr-0016-app-api-request-projection-and-operator-console-query-ownership.md`
- offline official-web ownership:
  `docs/architecture/domains/official-web/architecture.md`
- dining domain/data ownership: `docs/architecture/domains/dining/architecture.md`,
  `docs/data/dining.md`

## Local Development

```bash
pnpm install
pnpm --dir apps/app-api dev
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:node
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api test:shared-db-integration
pnpm ci:app-api-migration
pnpm --dir apps/app-api typecheck
```

Shared product database bootstrap entry points live under `apps/app-api/ops/db/`:

- `bootstrap-shared-product-database.ts` applies shared DB migrations. Dining
  catalog fixture import stays with `jobs/dining-sync`.
- `ensure-app-auth-role-search-path.ts`

The fixed shared product schemas include `app_auth.*` and `chat.*`.

Local Wrangler / Drizzle process env lives in `apps/app-api/.env`; Worker string
env for local runtime lives in `apps/app-api/.dev.vars`. Fill these app-local
files directly from the owning local secret store or deployment runbook; do not
fan out database URLs from the root worktree `.env`.

## Deployment Notes

Apply the complete App API schema installer with the direct management
connection before deploying a Worker revision that depends on the new schema.
It converges current auth/chat baselines, applies the immutable Drizzle journal
and then grants runtime roles:

```bash
APP_API_OPERATOR_DATABASE_URL="$DIRECT_DATABASE_URL" \
  pnpm --dir apps/app-api exec tsx ops/db/schema.ts
```

Do not run migrations through Hyperdrive or from the long-running Worker. After
the migration, verify the expected tables/columns through the same direct
connection before continuing deployment.

The deployed Worker must fail closed when required auth, database,
operator-admission or execution-control configuration is absent. Dynamic
product/API responses use `Cache-Control: no-store` unless a specific contract
states otherwise.

Observability policy and allowed telemetry fields are owned by
`docs/architecture/system/ops-observability.md` and the app-api observability
contracts; this app does not query telemetry sinks as product truth.
