---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-06
updated: 2026-07-10
---
# Temporal Self-Hosted Operations

## Boundary

This runbook covers the self-hosted Temporal execution substrate used by
`apps/execution-control`.

It does not define product request truth. Product-facing status, events, step
trajectory, panel, and eval reads come from the repo-owned sanitized projection
store.

## Runtime Truth

- Temporal owns workflow history, workflow/activity task queues, retry, timeout,
  heartbeat, signal, query, and cancellation mechanics.
- PG `runtime.agent_runs`, `runtime.agent_run_events`, `runtime.agent_run_steps`,
  `runtime.agent_step_attempts`, and `runtime.agent_step_results` own product and
  operator projection truth.
- Temporal history must not be exposed directly to browser, panel, or eval
  consumers.
- PG must not be reintroduced as an online execution queue or worker fallback.

## Persistence Backup

Temporal uses a dedicated persistence / visibility Postgres database. It must not
share the app product schema.

Required backup closeout fields:

- backup command timestamp
- Temporal namespace list before backup
- Postgres database name and host class, without password material
- backup artifact path or object-store key
- restore drill result or explicit blocker

Example closeout fields:

```json
{
  "component": "temporal-postgres",
  "environment": "staging",
  "backup_started_at": "2026-06-06T00:00:00Z",
  "namespace": "campus-agent-staging",
  "artifact_ref": "s3://ops-backups/temporal/staging/20260606T000000Z.dump",
  "restore_drill": "not_run",
  "blocker": ""
}
```

## Namespace Bootstrap

Required namespaces:

- `campus-agent-staging`
- `campus-agent-production`

Readiness must confirm:

- Temporal frontend reachable
- namespace exists
- namespace retention matches release policy
- workflow task queue has recent pollers
- required activity task queues have recent pollers

Required activity task queues:

- `campus-agent.activity.core`
- `campus-agent.activity.knowledge`

Tool-gated activity task queues:

- `campus-agent.activity.core`

If runtime config `open_tools` opens a concrete typed tool, the matching task
queue must have a poller. Missing pollers are a readiness blocker.

## Worker Identity

Worker identity must be explicit:

```text
<env>:<role>:<instance>
```

Examples:

- `staging:workflow:01`
- `staging:rag:01`
- `staging:finalization:01`
- `staging:notice:01`
- `staging:navigation:01`
- `staging:campus_services:01`

Do not rely on default PID / hostname identity as the operator-facing identity.

## Poller Closeout

Execution-control `/readyz` is the primary repo-owned readiness surface. It must
report:

- `temporal_runtime.configured=true`
- `temporal_runtime.healthy=true`
- `temporal_runtime.namespace=<environment namespace>`
- `temporal_runtime.task_queues`
- `temporal_runtime.task_queue_pollers`

For release closeout, save the full `/readyz` body and the command that produced
it.

## Failure-Mode Closeout

Release closeout must cover:

- Temporal unavailable: app-api / execution-control fail closed and do not enter
  a secondary worker fallback.
- Worker missing: execution-control `/readyz` is degraded because required
  Temporal task queue pollers are missing.
- Activity timeout/failure: run projection becomes `failed`, emits sanitized
  `activity.failed` and `run.failed`, and writes failed step / attempt / result
  projection.
- Cancel: execution-control cancels the Temporal workflow first, then writes a
  sanitized `canceled` projection.
- Late activity completion: terminal `failed` / `canceled` projection must not be
  overwritten by a late success path.

Closeout artifacts must not contain raw prompt, raw answer, raw provider
response, cookie, authorization header, raw source body, or object-store
credentials.

## Staging Durable Runtime Validation

Run the durable cutover preflight before treating execution-control staging as
Temporal-ready. The command reads only the ops-owned staging runtime env and the
current process env; it must not deploy, mutate remote state, or print secret
values:

```bash
pnpm repo:static
```

`CLOUDFLARE_API_TOKEN` stays in the deploy shell process env and must not be
written into the checkout. Environment-repository or cluster operator shells
must provide their own toolchain without recording host filesystem paths here.

For K8s staging, confirm the Argo CD PreSync schema Job completed and
its JSON log reports `passed=true`, `schema_ready=true`, and `store=postgres`:

```bash
kubectl -n campus-agent-staging get job execution-run-projection-schema
kubectl -n campus-agent-staging logs job/execution-run-projection-schema
```

Do not run schema installation manually for this GitOps path. The PreSync Job
must fail before runtime reconciliation when the database, schema command or
required Secret is unavailable.

Run the repo-owned Temporal-ready HTTP validation only from a network position
that can reach execution-control directly, such as inside the target K8s cluster or a
temporary port-forward. Staging no longer exposes execution-control through a
public ingress.

```bash
execution_control_url="${EXECUTION_CONTROL_INTERNAL_BASE_URL:-http://127.0.0.1:27051}"
go run ./cmd/temporal-runtime-http-check \
  --execution-control-url "$execution_control_url" \
  --shared-secret "$EXECUTION_CONTROL_SHARED_SECRET" \
  --evidence-path "$evidence_dir/execution-control-temporal-http-check.json"
```

Local validation cannot replace deployed
`campus-staging -> app-api-staging -> execution-control -> Temporal`
reconnect closeout. The validation passes only when `/readyz` reports both
`run_projection_store.healthy=true` and `temporal_runtime.healthy=true`.

## Worker Autoscaler Validation

### Docker Compose Transitional Validation

The worker autoscaler belongs to the Execution Operations Plane. It reads
app-api operator runtime task queue projections, reads Docker Compose replica
state, computes desired worker replicas, and publishes sanitized decision /
actuation projections back to app-api. It does not read app-api Postgres
directly, and it is not a default serving-loop component.

For manual validation, first run the task queue sampler:

```bash
cd apps/execution-control
workflow_queue="${EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE:-campus-agent.workflow}"
go run ./cmd/temporal-task-queue-sampler \
  --temporal-address "$EXECUTION_CONTROL_TEMPORAL_ADDRESS" \
  --temporal-namespace "$EXECUTION_CONTROL_TEMPORAL_NAMESPACE" \
  --workflow-task-queue "$workflow_queue" \
  --app-api-base-url "$EXECUTION_CONTROL_APP_API_BASE_URL" \
  --shared-secret "$EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET"
```

Then run the autoscaler dry-run:

```bash
go run ./cmd/worker-autoscaler \
  --mode dry-run \
  --app-api-base-url "$EXECUTION_CONTROL_APP_API_BASE_URL" \
  --shared-secret "$EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET" \
  --compose-project-name "$EXECUTION_CONTROL_COMPOSE_PROJECT_NAME" \
  --compose-project-directory "$EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY"
```

The app-api operator runtime projection must include:

- current Temporal task queue projections for each autoscaled service policy
- one autoscaler decision per target service
- `sourceSnapshotId` linking each decision to a task queue snapshot
- observed `backlog` and `oldestTaskAge` from Temporal
  `DescribeTaskQueue(report_stats=true)`
- explicit `unsupported_by_source` for `scheduleToStartLatency` until a dedicated
  latency metric source is wired

Apply mode is allowed only for the Docker Compose service allowlist documented in
`docs/contracts/operator-runtime.md`. The autoscaler must
not write workflow state, run projection, step projection, event projection,
terminal state, or downstream budget.

### Kubernetes Staging Validation

Kubernetes staging desired state lives in the deployment environment
repository. Render its execution overlay before merge:

```bash
kubectl kustomize clusters/<environment>/overlays/execution-runtime
```

Before merge, confirm the first-party Kustomize overlay renders the environment-owned
`execution-runtime-rendered-config` ConfigMap, and confirm the selected
secret-delivery path has created the required role-scoped Secrets,
`execution-runtime-provider-config-projection`,
`ghcr-campus-agent-pull`, and
`execution-runtime-qdrant-tls-ca`. The default slim execution-runtime Secret
set is:
`execution-control-secrets`, `execution-control-metrics-secrets`,
`execution-telemetry-client-secrets`, `execution-run-projection-secrets`,
`execution-temporal-workflow-secrets`, `execution-agent-client-secrets`, `agent-runtime-secrets`,
`execution-memory-client-secrets`, `execution-rag-secrets`,
`execution-tool-read-model-secrets`, and `execution-control-internal-query-secrets`.
`EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL` owns sanitized product/operator
projection. `EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL`, when configured, owns
the trace-observability workflow-run store and must not be treated as the same
database role. Do not create monolithic
`execution-runtime-secrets` or `execution-worker-common-secrets` Secrets. The provider-config
projection Secret is created from a reviewed `provider_config_projection.v1`
artifact by the selected secret-delivery path; it is not a handwritten example
Secret. The example ConfigMap under `infra/k8s/execution-runtime/base/` is a
documentation sample and must not be applied as real staging config.

The full first-party runtime validation only adds
`execution-app-api-internal-secrets` to the first-party runtime Secret set.
Temporal server lifecycle, Temporal database credentials and the stable
same-namespace `temporal:7233` alias are managed by the GitOps platform
Applications and the selected GitOps secret-delivery path, not by the
execution-runtime overlay. KEDA Temporal
scalers must use the environment's fully qualified Temporal Service endpoint
because they run from the `keda` namespace. OTel collector, Hindsight, Qdrant
and CNPG Secrets follow the same platform/data ownership rule.

Execution-runtime env renderers must not emit Kubernetes ConfigMap or Secret
YAML from local env files. Use tracked Kustomize config and the selected Secret
delivery backend instead.

Render before merge, then use the environment repository's runbook to wait for
Argo CD and first-party Deployment readiness:

```bash
kubectl kustomize clusters/<environment>/overlays/execution-runtime >/dev/null
```

The K8s staging validation must confirm:

- exactly one Deployment and one KEDA ScaledObject exist for each worker pool
- every ScaledObject has `minReplicaCount=1`
- `activity-worker-knowledge` has `maxReplicaCount=5`; other pools have
  `maxReplicaCount=3`
- every ScaledObject uses `targetQueueSize="8"`, `pollingInterval=15`,
  `cooldownPeriod=180` and HPA scale-down stabilization `300`
- `temporal-task-queue-sampler` writes fresh
  `temporal_task_queue_metrics_snapshot.v1`
- `keda-hpa-posture-collector` writes fresh
  `worker_autoscaler_posture.v1`

Operator-safe closeout material is read through app-api only:

```bash
curl -fsS "$APP_API_BASE_URL/api/operator/runtime/temporal-task-queues" \
  -H "authorization: Bearer $OPERATOR_TOKEN"

curl -fsS "$APP_API_BASE_URL/api/operator/runtime/autoscaler/postures" \
  -H "authorization: Bearer $OPERATOR_TOKEN"
```

Do not run Docker Compose `worker-autoscaler` against the same worker pool while
KEDA/HPA owns the Kubernetes Deployments.

## Closeout

A Temporal closeout is not complete until the closeout directory contains:

- execution-control `/readyz` body
- Temporal HTTP validation result
- Docker Compose worker-autoscaler dry-run closeout artifact, or K8s
  `worker_autoscaler_posture.v1` closeout artifact when KEDA/HPA owns the worker pool
- chat E2E run id / trace id
- step trajectory projection for at least one run
- Sentry / Axiom closeout artifact for the same time window
- failure-mode closeout artifact or explicit blocker

Failure-mode closeout must be captured through the current app-api/operator
projection surfaces and the staging smoke runner. Do not add
`infra/local/staging/*` evidence scripts. Each scenario record must include the
command, timestamp, host, git SHA, result, failure reason and related run id.
A cancel validation passes only when the sanitized synthesis attempt records
`provider_connection_aborted` and no finalization projection is written after
the canceled terminal state.
