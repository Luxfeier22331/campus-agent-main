---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0078
status: accepted
created: 2026-07-13
updated: 2026-07-13
supersedes:
  - adr-0056-k8s-keda.md
---
# ADR-0078 Worker Versioning

## Context

Static Kubernetes Deployments plus one long-lived KEDA ScaledObject per queue
cannot preserve Temporal Worker Deployment version identity across image
rollouts. Updating a worker image in place can place incompatible workflow code
behind the same unversioned poller set, while an autoscaler tied to one
Deployment does not follow draining versions.

## Decision

Production Temporal workers are managed by Temporal Worker Controller
`WorkerDeployment` resources.

- Temporal Worker Controller must be v1.8.0 or newer.
- Temporal Server must be v1.29.1 or newer.
- KEDA must be v2.20 or newer.
- Every SDK worker enables Worker Deployment Versioning with controller-injected
  `TEMPORAL_DEPLOYMENT_NAME` and `TEMPORAL_WORKER_BUILD_ID` and defaults to
  `PINNED`. Supplying only one variable is a startup error. Local development
  may omit both.
- Rollout strategy is `AllAtOnce`; Temporal routing and pinned workflow
  behavior, not a second application rollout controller, protect existing
  executions.
- KEDA `ScaledObject` and `PodDisruptionBudget` resources are attached per
  worker version through `WorkerResourceTemplate`.
- `scaleTargetRef: {}` and `selector.matchLabels: {}` are left for controller
  injection. KEDA resolves the Worker Deployment name and Build ID from the
  target worker environment.
- WorkerResourceTemplate Helm values must allow `ScaledObject` in
  `keda.sh/scaledobjects` and `PodDisruptionBudget` in
  `policy/poddisruptionbudgets`.
- `minReplicaCount: 1` is the baseline so a new version can register pollers and
  become current without a bootstrap deadlock.

Argo CD owns the desired `Connection`, `WorkerDeployment`, and
`WorkerResourceTemplate` resources and immutable image digest selection.
Temporal owns workflow/activity execution and version routing. KEDA/HPA owns
replica count. None of these systems writes product or ingestion workflow
truth into PostgreSQL.

Current WorkerDeployments are:

- execution: `execution-workflow`, `execution-core`, `execution-agent`;
- ingestion: `ingestion-control-worker`, `source-collector-worker`.

## Consequences

- Static worker Deployments and static per-Deployment ScaledObjects are removed.
- Each active/draining build receives its own autoscaler and PDB and is cleaned
  up with the WorkerDeployment sunset policy.
- Worker image/config changes create an explicit Temporal version.
- Cluster installation and GitOps overlays must be upgraded before applying
  these custom resources.

## References

- [Temporal Worker Controller v1.8.0](https://github.com/temporalio/temporal-worker-controller/releases/tag/v1.8.0)
- [WorkerResourceTemplate](https://github.com/temporalio/temporal-worker-controller/blob/v1.8.0/docs/worker-resource-templates.md)
- [Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning)
- [KEDA Temporal scaler 2.20](https://keda.sh/docs/2.20/scalers/temporal/)
- `docs/architecture/system/k8s-runtime.md`
- `docs/runbooks/temporal-self-host-operations.md`
