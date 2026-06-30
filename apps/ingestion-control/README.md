# campus-ingestion-control

Internal task control plane for ingestion/data-plane execution.

This package is the first implementation slice of the target ingestion runtime:

- admits validated ingestion task envelopes
- owns task idempotency and claim/lease lifecycle
- dispatches registry-declared `ts_control` / `rust_kernel` task handlers
- records terminal closeout state
- exposes redacted operator task projections
- keeps execution out of `apps/app-api`
- materializes `campus_notices/internal_notice` source truth from
  `authenticated_notice_capture_release.v1` object-store input refs
- verifies `official_web_source_truth_bundle.v1` object-store input refs
  for `official_web/stable_reference` and `official_web/fresh_news`

Runtime mode is Postgres-backed and fail-closed:

- `INGESTION_CONTROL_DATABASE_URL` is required
- `INGESTION_TASK_REGISTRY_ROOT` is required and must point at repo task
  registries, for example `configs/ingestion`; task admission fails closed
  before storage when the registry entry or output contract is missing
- `INGESTION_CONTROL_HOST` defaults to `0.0.0.0`
- `INGESTION_CONTROL_PORT` defaults to `8000`
- `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_SOURCE_ACCESS_KEY`,
  `OBJECT_STORE_SOURCE_SECRET_KEY` and optional `OBJECT_STORE_BUCKET_SOURCE`
  configure source-bucket access for object-store backed task handlers
- `INGESTION_KERNEL_RUNNER_PATH` optionally points to the
  `ingestion-kernel-runner` binary; if omitted, ingestion-control expects it on
  `PATH`
- `INGESTION_EXECUTOR_WORKER_ID` optionally sets the executor worker identity
- `INGESTION_EXECUTOR_POLL_INTERVAL_MS` optionally sets the executor idle poll
  interval; default is `5000`

Registry-declared `ts_control` tasks are not replaced by generic closeout
skeletons. If a collection-specific handler is not registered, the task fails
closed.

Registry-declared Rust kernels use the source-bucket object-store bridge and the
Rust binary from `packages/ingestion-kernels-rs`. Without object-store access,
default Rust kernels are not registered and tasks fail closed with
`rust_kernel_not_registered`; ingestion-control does not provide JS or Python
stand-ins for deterministic kernels.

## Runtime Roles

`apps/ingestion-control` is a self-hosted internal service package, not a
Cloudflare Worker.

- `ingestion-control-api`: HTTP control-plane surface for task admission,
  readiness and operator-safe projections.
- `ingestion-control-executor`: background executor worker process for
  claim / lease / registry-aware execution / terminal closeout.
- `runRegistryTaskOnce`: one-shot library seam used by the executor role and
  tests; it is not a substitute for a long-running deployment process.

The API and executor roles may share the same package or image, but they must be
deployed as different runtime processes and scaled independently.

Local control-plane run:

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export INGESTION_TASK_REGISTRY_ROOT=configs/ingestion
pnpm --filter ingestion-control start:api
```

The in-memory store is retained only for tests and contract development; it is
not the service runtime default.

Local executor run:

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export INGESTION_TASK_REGISTRY_ROOT=configs/ingestion
pnpm --filter ingestion-control start:executor
```

The API command starts the HTTP control-plane surface. The executor command
starts the long-running executor worker process. They must remain separate
runtime processes and must not be hidden inside `apps/app-api` or collector
processes.
