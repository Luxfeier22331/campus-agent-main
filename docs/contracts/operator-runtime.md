---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-16
updated: 2026-06-16
---
# Operator Runtime Observability Contract

## Boundary

`apps/app-api` owns operator-safe runtime projections. `apps/execution-control`
may publish sanitized runtime observations through internal app-api HTTP
endpoints, but it must not write the app-api database directly.

This contract covers:

- `temporal_task_queue_metrics_snapshot.v1`
- `worker_autoscaler_posture.v1`
- `worker_autoscaler_decision.v1` where a runtime produces a normalized
  decision observation
- `worker_autoscaler_actuation.v1` where a runtime produces a normalized scale
  event observation
- release eval consumption of `operator_step_trajectory.v1`

It does not expose Temporal workflow history, raw Temporal responses, raw
provider traces, prompts, cookies, tokens or object-store credentials.

## Temporal Task Queue Snapshot

Producer: `apps/execution-control/cmd/temporal-task-queue-sampler`

Ingest endpoint:

`POST /api/internal/operator/runtime/temporal-task-queue-snapshots`

Internal query endpoint for execution-control:

`GET /api/internal/operator/runtime/temporal-task-queues?limit=<n>`

Operator query endpoint:

`GET /api/operator/runtime/temporal-task-queues`

Payload schema version:

`temporal_task_queue_metrics_snapshot.v1`

Snapshot fields:

- `snapshotId`
- `namespace`
- `taskQueue`
- `taskQueueKind`: `workflow | activity`
- `source`
- `pollerCount`
- `pollerIdentities`
- `backlog`
- `oldestTaskAge`
- `scheduleToStartLatency`
- `sampledAt`

Current sampler source is Temporal `DescribeTaskQueue(report_stats=true)`.
Therefore:

- `pollerCount` and `pollerIdentities` are observed.
- `backlog` is observed from Temporal approximate backlog count.
- `oldestTaskAge` is observed from Temporal approximate backlog age when the
  server reports it.
- `scheduleToStartLatency` must be emitted as
  `{ "state": "unsupported_by_source" }` until a dedicated latency metric source
  is wired.
- Consumers must not infer unsupported values from zero, empty arrays or missing
  fields.

## Worker Autoscaler Decision

Current Docker Compose producer: `apps/execution-control/cmd/worker-autoscaler`.

Kubernetes target posture producer:
`apps/execution-control/cmd/keda-hpa-posture-collector` writing through app-api
internal ingest.

The autoscaler reads the latest app-api runtime task queue projection, reads
Docker Compose replica state, computes desired worker replicas and publishes
decisions back through app-api internal ingest.

Load-based scale-up requires consecutive observed backlog or oldest-task-age
breaches. Load-based scale-down requires consecutive observed idle windows.
Unsupported load metrics cannot drive load scaling; poller absence may still
drive presence repair within the service policy replica budget. Cooldown uses
recent `worker_autoscaler_actuation.v1` projection read through the app-api
internal runtime query seam; active cooldown returns a `hold` decision with
`reason=cooldown_active`.

Production target uses KEDA Temporal scaler and Kubernetes HPA for decision /
replica control. In that mode `worker_autoscaler_decision.v1` is optional
operator-safe observation of KEDA/HPA desired-vs-current state, not a repo-owned
Go controller decision. First-stage Kubernetes runtime closeout must rely on
`worker_autoscaler_posture.v1`; it must not require a repo-owned K8s scale
decision loop.

Decision fields:

- `decisionId`
- `targetService`
- `taskQueue`
- `taskQueueKind`
- `decision`: `scale_up | scale_down | hold`
- `currentReplicas`
- `desiredReplicas`
- `budgetState`: `within_budget | budget_exhausted | actuation_disabled`
- `reason`
- `sourceSnapshotId`
- `evidence`
- `decidedAt`

Fail-closed requirements:

- every target service must have an explicit service policy
- every service policy must resolve to a source snapshot
- every target service must have replica state
- apply mode must use an allowlisted actuator target
- unsupported source metrics stay explicit in `evidence`

## Worker Autoscaler Actuation

Apply mode uses the Docker Compose actuator for local/staging compose runtime.
Allowed services are:

- `workflow-worker`
- `activity-worker-core`
- `activity-worker-agent`
- `activity-worker-knowledge`

Actuation fields:

- `actuationId`
- `decisionId`
- `targetService`
- `actuatorKind`: `docker_compose | keda_hpa`
- `action`: `scale | none`
- `status`: `applied | skipped | failed`
- `fromReplicas`
- `toReplicas`
- `actedAt`
- `errorCode`

When Docker Compose apply fails, execution-control must publish a failed
actuation with `errorCode=docker_compose_scale_failed` before returning the
actuation error. The failed actuation is diagnostic evidence, not a successful
scale operation.

Operator query endpoints:

- `GET /api/operator/runtime/autoscaler/decisions`
- `GET /api/operator/runtime/autoscaler/actuations`

The autoscaler may adjust worker replica count only. It must not write Temporal
workflow history, run projection, step projection, event projection, final
answer state or downstream budget state.

In Kubernetes target runtime:

- `keda_hpa` actuation evidence is optional. When produced, it represents a
  normalized Kubernetes scale event / HPA desired replica change observed by a
  projection collector, not an execution-control control operation.
- KEDA/HPA owns replica control for worker Deployments.
- Docker Compose `worker-autoscaler` must not run as a parallel production
  controller for the same worker pool.
- Operator query endpoints stay the same; response payloads remain sanitized and
  must not include raw Kubernetes API objects, KEDA internals, Temporal history
  or credentials.

## Worker Autoscaler Posture

Payload schema version:

`worker_autoscaler_posture.v1`

This projection summarizes scaler health for release closeout and operator
diagnosis.

For the Kubernetes target runtime this is the first-stage mandatory autoscaling
projection. Decision and actuation projections may be added later as normalized
observations, but posture is the required release closeout surface.

Fields:

- `observedAt`
- `targetService`
- `taskQueue`
- `taskQueueKind`
- `scalerKind`: `keda_temporal | docker_compose`
- `scalerStatus`: `healthy | degraded | paused | disabled`
- `metricFreshness`
- `currentReplicas`
- `desiredReplicas`
- `minReplicas`
- `maxReplicas`
- `lastScaleEventId`
- `lastScaleEventAt`
- `reason`
- `evidence`

Evidence may include sanitized KEDA event fields:

- `kedaEventReason`
- `kedaEventType`
- `kedaEventMessage`
- `kedaEventAt`

Rules:

- metric-stale / HPA metric-fetch failure / KEDA paused state must be explicit.
- KEDA fallback events must set `scalerStatus=degraded` with
  `reason=keda_fallback_active`.
- KEDA scaler / metric-source failure events must set `scalerStatus=degraded`
  with `reason=keda_metric_source_failed`.
- KEDA pause annotations must set `scalerStatus=paused` with
  `reason=keda_scaledobject_paused`.
- projection consumers must not infer scaler health from missing fields.
- release closeout must fail closed when posture is missing for a production
  worker pool that is expected to autoscale.

Ingest endpoint:

`POST /api/internal/operator/runtime/temporal-task-queue-snapshots`

Operator query endpoint:

`GET /api/operator/runtime/autoscaler/postures`

Internal query endpoint:

`GET /api/internal/operator/runtime/autoscaler/postures`

The K8s posture collector may read only Deployment, HPA, KEDA ScaledObject
status and core Kubernetes Events in its namespace. It must not expose raw
Kubernetes API objects, credentials, Temporal history, prompts or provider
payloads.

## Eval Release Consumption

Eval release diagnostics consume operator-safe app-api observability details:

`GET /api/operator/requests/:requestId/observability`

The release consumer normalizes `runtimeRun.operatorStepTrajectory` into
`operator_step_trajectory.v1` and injects it into diagnostic reports before
building operator badcases.

Release mode is fail-closed:

- missing request correlation is a blocker
- missing `runtimeRun.operatorStepTrajectory` is a blocker
- low-score badcases with `trajectory_missing` or `attribution_missing` are
  blockers
- eval artifacts must not contain Temporal history, raw traces, prompts,
  transcripts, auth headers or local object-store paths
