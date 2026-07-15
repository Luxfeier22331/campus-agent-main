# ingestion-control

Temporal-backed control plane for offline ingestion tasks.

## Ownership

This app owns:

- authenticated task admission through `ingestion_task_envelope.v3`;
- registry snapshot validation through `ingestion_task_registry.v3`;
- one Temporal workflow per task;
- PostgreSQL task, official-web URL freshness, and configured-seed projections;
- control activities and the Rust kernel process bridge;
- terminal projection from a single object-store-backed
  `ingestion_task_result.v1`.

It does not crawl providers, run a second scheduler, keep a run ledger, publish
online query targets, or execute Python fallback handlers. Source capture runs
in `apps/source-collector`; deterministic file kernels run through
`packages/ingestion-kernels-rs`.

## Runtime Roles

| Role | Command | Responsibility |
| --- | --- | --- |
| HTTP API | `pnpm --filter ingestion-control start:api` | Validate a v3 envelope, freeze the registry task, start Temporal, and expose bounded task projections. |
| Temporal worker | `pnpm --filter ingestion-control start:temporal-worker` | Poll workflow, control-activity, and Rust-kernel queues and write terminal projections. |
| Schema migration | `pnpm --filter ingestion-control migrate` | Apply ordered SQL migrations under one advisory lock and verify the migration journal. |

Production keeps these roles in one package but publishes separate image
targets:

| Image | Docker target | Consumer |
| --- | --- | --- |
| `ingestion-control` | `api` | HTTP Deployment and schema migration command. |
| `ingestion-control-worker` | `worker` | Temporal WorkerDeployment with the Rust runner and frozen embedding tokenizer. |

The source-collector activity queue is polled by the separate
`source-collector` image. Kubernetes production workers are managed through
Temporal Worker Controller `WorkerDeployment` resources; the controller
injects `TEMPORAL_DEPLOYMENT_NAME` and `TEMPORAL_WORKER_BUILD_ID` together.
Local workers may omit both variables and run unversioned.

Canonical queues:

- `campus-agent.ingestion.workflow`
- `campus-agent.ingestion.activity.control`
- `campus-agent.ingestion.activity.rust-kernel`
- `campus-agent.ingestion.activity.source-collector`

## HTTP Surface

- `POST /internal/ingestion/tasks`: admin-token task admission.
- `GET /internal/ingestion/tasks/:taskId`: admin-token task detail.
- `GET /internal/ingestion/operator-projection/tasks`: app-api projection token.
- `GET /healthz`: process liveness.
- `GET /readyz`: live PostgreSQL and Temporal dependency readiness.

There are no source-specific lifecycle routes. A collector is invoked only by
the workflow through its activity task queue.

## Storage

`migrations/0001_tasks.sql` defines the current schema. PostgreSQL stores the
bounded task projection plus latest official-web URL and configured-seed state.
Temporal is the workflow truth; object storage is the artifact truth. Source
capture uses the source bucket, while Rust kernels use separate derived-bucket
credentials for canonical inputs and deterministic outputs. The process fails
at startup when the required database schema is absent or still contains
retired lease/task-kind columns.

Object writes are create-or-verify and every cross-runtime ref contains a
SHA-256 digest plus byte size. Preparation, Rust-kernel and terminal result
artifacts are attempt-scoped under
`runs/<run-id>/attempts/<activity-attempt>/`; a retry cannot overwrite bytes
from an earlier attempt. Official-web freshness upserts order observations by
`(observed_at, last_observed_run_id)` so equal timestamps converge
deterministically instead of allowing a late run to overwrite a newer one.

## Local Run

Start Temporal, PostgreSQL, and the object store, apply the current migration,
then load `env/commands/ingestion-control-runtime.env.example` into the shell.

```bash
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

Local image builds use the same Dockerfile with explicit targets:

```bash
docker build --target api -f apps/ingestion-control/Dockerfile -t ingestion-control .
docker build --target worker -f apps/ingestion-control/Dockerfile -t ingestion-control-worker .
```

## Verification

```bash
pnpm ci:ingest
```
