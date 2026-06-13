# campus-ingestion-control

Internal task control plane for ingestion/data-plane execution.

This package is the first implementation slice of the target ingestion runtime:

- admits validated ingestion task envelopes
- owns task idempotency and claim/lease lifecycle
- records terminal closeout state
- exposes redacted operator task projections
- keeps execution out of `apps/app-api`

Runtime mode is Postgres-backed and fail-closed:

- `INGESTION_CONTROL_DATABASE_URL` is required
- `INGESTION_CONTROL_HOST` defaults to `0.0.0.0`
- `INGESTION_CONTROL_PORT` defaults to `8000`

Local run:

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
pnpm --filter ingestion-control start
```

The in-memory store is retained only for tests and contract development; it is
not the service runtime default.
