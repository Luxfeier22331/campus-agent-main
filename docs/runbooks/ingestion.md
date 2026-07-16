---
doc_type: runbook
truth_scope: ops
owner_boundary: apps/ingestion-control
status: active
created: 2026-07-13
updated: 2026-07-16
---
# Ingestion

## Purpose

Operate the Temporal-backed ingestion API and workers. This runbook does not
cover source-specific HTTP callbacks, run ledgers, or publication to online
query targets because those surfaces do not exist.

## Prerequisites

- PostgreSQL reachable by the environment's ingestion migration job;
- S3-compatible source and derived buckets with separate credentials;
- Temporal namespace;
- ingestion-control API, ingestion-control worker, and source-collector images
  built from the same source revision;
- v3 task registries under `configs/ingestion`;
- provider credentials for any source task being run.

The local migration command is `pnpm --filter ingestion-control migrate`. A
containerized migration Job uses the image's installed executable directly:

```text
/app/apps/ingestion-control/node_modules/.bin/tsx \
  /app/apps/ingestion-control/src/migrate.ts
```

Runtime containers do not invoke Corepack or pnpm. The runner uses a
transaction-scoped advisory lock, applies ordered SQL files once, and stores
each file's SHA-256 in `ingestion_control.schema_migrations`. Reapplying the
same revision is a no-op; modifying an already-applied file fails closed. An
unjournaled pre-existing target table is rejected by the SQL migration rather
than silently adopted or dropped.

The deployment also runs the installed `schedule-sync.ts` entrypoint as a
PostSync Job. It reconciles the fixed 30-minute internal-portal authentication
Schedule. A missing Schedule is created paused until Ops Web writes the first
valid TGC; later syncs preserve its current paused state.

## Local Runtime

Load the values from
`env/commands/ingestion-control-runtime.env.example`, then run the three
processes in separate shells:

```bash
pnpm --filter ingestion-control migrate
pnpm --filter ingestion-control start:api
pnpm --filter ingestion-control start:temporal-worker
pnpm --filter source-collector start:temporal-worker
```

Local workers omit `TEMPORAL_DEPLOYMENT_NAME` and
`TEMPORAL_WORKER_BUILD_ID`. Production Worker Controller injects both.

Health checks:

```bash
curl -fsS http://127.0.0.1:8000/healthz
curl -fsS http://127.0.0.1:8000/readyz
```

## Submit A Task

Write the request document to the source bucket, calculate SHA-256, and submit
only the v3 envelope:

```bash
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version": "ingestion_task_envelope.v3",
    "task_id": "task-001",
    "run_id": "run-001",
    "registry_task_id": "official_web.capture",
    "input_ref": {
      "kind": "object_store",
      "uri": "s3://campus-agent-source/requests/run-001.json",
      "digest": "sha256:REPLACE_WITH_64_HEX_CHARACTERS"
    }
  }' \
  http://127.0.0.1:8000/internal/ingestion/tasks
```

`202` means Temporal accepted the workflow or confirmed that the same workflow
is still running. The canonical workflow id is `ingestion/<task_id>`. Reusing a
task id is idempotent only when `run_id`, `registry_task_id`, and `input_ref`
still match the frozen request; a mismatch returns `409 ingestion_task_conflict`.
Use a new task id for a new execution. A closed duplicate with no PostgreSQL
projection returns `409 ingestion_projection_missing` and its Temporal status
instead of pretending that work was accepted again.

The example is a source-collector task. Rust kernel envelopes reference
canonical document units in the derived bucket and write their result artifact
back to that bucket.

## Inspect

Task detail:

```bash
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_ADMIN_TOKEN}" \
  http://127.0.0.1:8000/internal/ingestion/tasks/task-001
```

Operator projection:

```bash
curl -fsS \
  -H "Authorization: Bearer ${INGESTION_CONTROL_APP_API_PROJECTION_TOKEN}" \
  'http://127.0.0.1:8000/internal/ingestion/operator-projection/tasks?limit=50'
```

Use Temporal UI/CLI for workflow history, attempts, heartbeats, timeout, and
cancellation details. PostgreSQL is a bounded projection, not a replacement
for Temporal history.

## Cancel

Cancellation uses Temporal directly; there is no source-specific cancel route.

```bash
temporal workflow cancel \
  --address "${INGESTION_TEMPORAL_ADDRESS}" \
  --namespace "${INGESTION_TEMPORAL_NAMESPACE}" \
  --workflow-id ingestion/task-001
```

The workflow cancels the active activity and records `canceled` through its
non-cancellable projection cleanup, then preserves the Temporal Workflow
`Canceled` outcome. After an executor has returned its result, the completion
projection is the non-cancellable terminal commit point; a later cancel request
does not replace an accepted result with a contradictory canceled projection.
Do not edit the PostgreSQL row manually.

## Kubernetes

Render before changing the environment repository:

```bash
kubectl kustomize infra/k8s/ingestion-runtime/base >/tmp/ingestion-runtime.yaml
kubeconform -strict -ignore-missing-schemas /tmp/ingestion-runtime.yaml
```

The environment overlay must provide:

- `ingestion-runtime-rendered-config`;
- `ingestion-control-secrets` with the control database URL and internal API tokens;
- the existing `object-store-secrets` with separate source and derived identities;
- `source-collector-internal-portal-auth` when internal-portal capture is enabled;
- immutable `ingestion-control`, `ingestion-control-worker`, and
  `source-collector` image digests;
- Temporal endpoint/namespace patches for both Connection and KEDA triggers;
- schema migration job ordering before API/workers;
- one shared `INGESTION_CONTROL_OPS_TOKEN` value delivered to ingestion-control
  and Ops Web for the fixed maintenance read/resume operations.

Secret objects are grouped by credential owner and mutation boundary, not by
Pod. Workloads use explicit `secretKeyRef` entries instead of Secret-wide
`envFrom`: source-collector receives only the source object-store pair, while
the ingestion worker receives source and derived pairs. The two identities
retain separate object-store policies even though the environment delivers
them through the existing `object-store-secrets` object. Provider credentials
are injected only by an environment that enables that provider; internal-portal
capture does not require a provider Secret.

`source-collector-internal-portal-auth` contains only the `sso_tgc` key and is
mounted as a complete optional Secret volume. Internal-portal tasks fail when
the file is absent, while unrelated source-collector adapters remain available.
The environment creates this Secret once without credential data. Routine TGC
replacement uses the fixed Ops Web operation rather than a SealedSecret PR;
see `notice-release-auth-window.md`.

The base runs all ingestion containers as non-root with a read-only root
filesystem and no mounted service-account token. Writable state is limited to
`emptyDir` volumes: `/tmp` for process/browser runtime data, the collector's
Crawlee storage directory, and a bounded memory-backed `/dev/shm` for Chromium.
Keep the Pod `fsGroup`; fresh volumes otherwise may not be writable by the
image's non-root user.

## Worker Diagnosis

```bash
kubectl get connection,workerdeployment,workerresourcetemplate
kubectl get deployment,scaledobject,poddisruptionbudget
kubectl describe workerdeployment ingestion-control-worker
kubectl describe workerdeployment source-collector-worker
```

Check in this order:

1. Connection health and Temporal namespace;
2. target/current Worker Deployment build IDs;
3. worker pod startup and both injected version variables;
4. WorkerResourceTemplate status and generated ScaledObject/PDB;
5. Temporal pollers and activity heartbeat freshness;
6. object-store digest errors;
7. bounded task projection.

## Failure Rules

- Missing registry/config/schema/credential: fix configuration; do not add a
  fallback executor.
- Digest mismatch: reject the task/artifact; do not recalculate and accept it.
- Activity timeout: inspect last heartbeat and provider/object-store latency,
  then start a new task when appropriate.
- Temporary object-store or PostgreSQL projection failure after successful
  execution: let Temporal retry the control activity; do not rerun capture.
- Result manifest, digest, observation schema, or frozen-identity mismatch: the
  task fails as `invalid_ingestion_task_result`; fix the producer before
  starting a new task.
- Failed source capture: retain written artifacts for diagnosis and start a new
  task id after correcting the cause.

## Verification

```bash
pnpm ci:contracts
pnpm ci:ingest
pnpm ci:rust
```

Run staging capture only when validating an environment or release; it is not a
normal local implementation check.
