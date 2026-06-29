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
- official-web, dining, provider-config and campus-services operation routes
- docs reader import/export and read-model APIs

Endpoint-level wire truth belongs in `docs/contracts/app-api/`; this README is
only the app entry point.

## Data And Runtime Ownership

`app-api` owns the Worker-side product schemas for auth, chat, runtime request
ledger/outbox, operator projections, official-web control-plane projections,
profile projection and related operation surfaces.

Durable schema and database ownership live in:

- `docs/data/app-api/README.md`
- `docs/data/app-api/runtime.md`
- `docs/data/app-api/operator.md`
- `docs/data/app-api/official-web.md`
- `docs/data/postgres-ownership.md`

`APP_API_DB` and `APP_API_DB_FRESH` are two Hyperdrive lanes to the same shared
Postgres, not two logical databases. Read-after-write-sensitive paths must be
explicitly admitted by the data owner docs.

## References

- product/runtime boundary: `docs/architecture/system/product-runtime.md`
- current accepted topology: `docs/architecture/current.md`
- identity/auth: `docs/architecture/system/identity-platform.md`
- app-api contracts: `docs/contracts/app-api/README.md`
- app-api data: `docs/data/app-api/README.md`
- operator ownership: `docs/decisions/adr-0016-app-api-request-projection-and-operator-console-query-ownership.md`
- official-web ownership: `docs/decisions/adr-0018-app-api-official-web-control-plane-ownership.md`

## Local Development

```bash
pnpm install
pnpm --dir apps/app-api dev
pnpm --dir apps/app-api test
pnpm --dir apps/app-api test:worker
pnpm --dir apps/app-api typecheck
```

Local Wrangler / Drizzle process env lives in `apps/app-api/.env`; Worker string
env for local runtime lives in `apps/app-api/.dev.vars`. When root `.env`
contains `CAMPUS_SHARED_POSTGRES_URL`, generate local app-api database env with:

```bash
uv run --all-packages python -m scripts.sync_app_api_local_db_env \
  --repo-root <current-worktree-root>
```

## Deployment Notes

The deployed Worker must fail closed when required auth, database,
operator-admission or execution-control configuration is absent. Dynamic
product/API responses use `Cache-Control: no-store` unless a specific contract
states otherwise.

Observability policy and allowed telemetry fields are owned by
`docs/architecture/system/ops-observability.md` and the app-api observability
contracts; this app does not query telemetry sinks as product truth.
