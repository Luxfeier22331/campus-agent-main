---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-06-06
updated: 2026-06-06
---
# Temporal Self-Hosted Operations

## Scope

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
- Old PG lease / worker loop / recovery loop artifacts are historical migration
  material and must not be used as an online serving fallback.

## Persistence Backup

Temporal uses a dedicated persistence / visibility Postgres database. It must not
share the app product schema.

Required backup evidence:

- backup command timestamp
- Temporal namespace list before backup
- Postgres database name and host class, without password material
- backup artifact path or object-store key
- restore drill result or explicit blocker

Example evidence fields:

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
- `campus-agent-prod`

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

If runtime profile `open_tools` opens a concrete typed tool, the matching task
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

## Poller Evidence

Execution-control `/readyz` is the primary repo-owned readiness surface. It must
report:

- `temporal_runtime.configured=true`
- `temporal_runtime.healthy=true`
- `temporal_runtime.namespace=<environment namespace>`
- `temporal_runtime.task_queues`
- `temporal_runtime.task_queue_pollers`

For release closeout, save the full `/readyz` body and the command that produced
it.

## Failure-Mode Evidence

Release evidence must cover:

- Temporal unavailable: app-api / execution-control fail closed and do not enter
  a PG lease worker fallback.
- Worker missing: execution-control `/readyz` is degraded because required
  Temporal task queue pollers are missing.
- Activity timeout/failure: run projection becomes `failed`, emits sanitized
  `activity.failed` and `run.failed`, and writes failed step / attempt / result
  projection.
- Cancel: execution-control cancels the Temporal workflow first, then writes a
  sanitized `canceled` projection.
- Late activity completion: terminal `failed` / `canceled` projection must not be
  overwritten by a late success path.

Evidence must not contain raw prompt, raw answer, raw provider response, cookie,
authorization header, raw source body, or object-store credentials.

## Worker Autoscaler Proof

### Docker Compose Transitional Proof

The worker autoscaler belongs to the Execution Operations Plane. It reads
app-api operator runtime task queue projections, reads Docker Compose replica
state, computes desired worker replicas, and publishes sanitized decision /
actuation projections back to app-api. It does not read app-api Postgres
directly, and it is not a default serving-loop component.

On the staging host, prefer the explicit one-shot proof entrypoint:

```bash
infra/local/staging/run-execution-control-ops-proof.sh
```

For manual local proof, first run the task queue sampler:

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

### Kubernetes Staging Proof

First-stage Kubernetes staging manifests live at:

```bash
kubectl kustomize infra/k8s/execution-runtime/overlays/staging
```

Before apply, create `execution-runtime-secrets` in `campus-agent-staging` from
the same keys shown in
`infra/k8s/execution-runtime/base/secret.example.yaml`. The example file is not
part of the Kustomize resources and must not be applied as real credentials.

Render and apply:

```bash
kubectl kustomize infra/k8s/execution-runtime/overlays/staging > /tmp/campus-agent-k8s-staging.yaml
kubectl apply -f /tmp/campus-agent-k8s-staging.yaml
kubectl -n campus-agent-staging wait \
  --for=condition=available deploy/execution-control \
  --timeout=300s
kubectl -n campus-agent-staging wait \
  --for=condition=available deploy/agent-runtime \
  --timeout=300s
```

The K8s staging proof must confirm:

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

Operator-safe evidence is read through app-api only:

```bash
curl -fsS "$APP_API_BASE_URL/api/operator/runtime/temporal-task-queues" \
  -H "authorization: Bearer $OPERATOR_TOKEN"

curl -fsS "$APP_API_BASE_URL/api/operator/runtime/autoscaler/postures" \
  -H "authorization: Bearer $OPERATOR_TOKEN"
```

Do not run Docker Compose `worker-autoscaler` against the same worker pool while
KEDA/HPA owns the Kubernetes Deployments.

## Closeout

A Temporal closeout is not complete until the evidence directory contains:

- execution-control `/readyz` body
- Temporal HTTP proof result
- Docker Compose worker-autoscaler dry-run evidence, or K8s
  `worker_autoscaler_posture.v1` evidence when KEDA/HPA owns the worker pool
- chat E2E run id / trace id
- step trajectory projection for at least one run
- Sentry / Axiom evidence for the same time window
- failure-mode evidence or explicit blocker

Failure-mode evidence is captured per scenario:

```bash
infra/local/staging/capture-temporal-rag-closeout-evidence.sh \
  --request-id <request_id> \
  --scenario normal-answer

infra/local/staging/capture-temporal-rag-closeout-evidence.sh \
  --request-id <request_id> \
  --scenario cancel-during-synthesis

infra/local/staging/capture-temporal-rag-closeout-evidence.sh \
  --request-id <request_id> \
  --scenario activity-timeout-late-completion
```

Each scenario directory must contain `PASS_FAIL.md` with command, timestamp,
host, git SHA, result, and failure reason. A cancel proof passes only when the
sanitized synthesis attempt records `provider_connection_aborted` and no
finalization projection is written after the canceled terminal state.
