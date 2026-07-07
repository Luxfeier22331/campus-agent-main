# campus-ingestion-control

Internal task control plane for ingestion/data-plane execution.

This app owns the ingestion Temporal runtime boundary. Runtime-neutral package
helpers may be reused here, but Temporal workflow/activity execution,
object-store access, handler registration, registry-aware activity invocation
and terminal closeout stay in this app boundary. The generic registry-aware
task dispatcher and stable execution error-code mapping are imported from
`packages/ingest-core`; this app wires that dispatcher to Temporal activities,
concrete handlers, object-store access and task closeout storage.

This package is the first implementation slice of the target ingestion runtime:

- admits validated ingestion task envelopes
- owns task idempotency, Temporal workflow start and terminal closeout
- dispatches registry-declared `ts_control` / `rust_kernel` task handlers
- records terminal closeout state
- exposes redacted operator task projections
- keeps execution out of `apps/app-api`
- materializes `campus_notices/internal_notice` source truth from
  `authenticated_notice_capture_release.v1` object-store input refs
- materializes `authenticated_documents/file_release_source` source truth from
  verified `internal_portal_file_release_export_v1` object-store input refs
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
- `INGESTION_KERNEL_TOKENIZER_JSON_PATH` points at the local Hugging Face
  `tokenizer.json` used by token-aware `chunk-document-units`; if omitted,
  tokenizer-dependent kernels are not registered and matching tasks fail closed
- `INGESTION_TEMPORAL_ADDRESS` is required
- `INGESTION_TEMPORAL_NAMESPACE` defaults to `default`
- `INGESTION_TEMPORAL_WORKFLOW_TASK_QUEUE` defaults to
  `campus-agent.ingestion.workflow`
- `INGESTION_TEMPORAL_CONTROL_ACTIVITY_TASK_QUEUE` defaults to
  `campus-agent.ingestion.activity.control`

Registry-declared `ts_control` tasks are not replaced by generic closeout
skeletons. If a collection-specific handler is not registered, the task fails
closed. Runtime execution also rejects non-`object_store` task input refs before
handler dispatch; collector-run tokens, local files and Postgres row refs are
not default source-truth materialization inputs.

Registry-declared Rust kernels use the source-bucket object-store bridge and the
Rust binary from `packages/ingestion-kernels-rs`. Without object-store access,
default Rust kernels are not registered and tasks fail closed with
`rust_kernel_not_registered`; ingestion-control does not provide JS or Python
stand-ins for deterministic kernels.
`chunk-document-units` resolves collection-specific token budgets from
`chunk-profile.json` files under `INGESTION_TASK_REGISTRY_ROOT`; the Temporal
worker parses those profiles in TypeScript and passes resolved numeric CLI
arguments to the Rust runner. `chunk-document-units` and
`validate-document-units` / `validate-release-manifest` can run without
tokenizer configuration.

## Runtime Roles

`apps/ingestion-control` is a self-hosted internal service package, not a
Cloudflare Worker.

| Role | Command | Runtime responsibility |
| --- | --- | --- |
| `ingestion-control-api` | `pnpm --filter ingestion-control start:api` | HTTP control-plane surface for task admission, Temporal workflow start, readiness and operator-safe projections. |
| `ingestion-control-temporal-worker` | `node --experimental-strip-types apps/ingestion-control/src/temporal-worker.ts` inside the shared container image; `pnpm --filter ingestion-control start:temporal-worker` for local dev | Temporal workflow/activity worker process for registry-aware execution and terminal closeout. |

The API and worker roles may share the same package or image, but they must be
deployed as different runtime processes and scaled independently.

Local control-plane run:

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export INGESTION_TASK_REGISTRY_ROOT=configs/ingestion
export INGESTION_TEMPORAL_ADDRESS=127.0.0.1:7233
pnpm --filter ingestion-control start:api
```

The in-memory store is retained only for tests and contract development; it is
not the service runtime default.

Local Temporal worker run:

```bash
export INGESTION_CONTROL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
export INGESTION_TASK_REGISTRY_ROOT=configs/ingestion
export INGESTION_TEMPORAL_ADDRESS=127.0.0.1:7233
pnpm --filter ingestion-control start:temporal-worker
```

The API command starts the HTTP control-plane surface. The Temporal worker
command starts the long-running workflow/activity worker process. They must
remain separate runtime processes and must not be hidden inside `apps/app-api`
or collector processes.
