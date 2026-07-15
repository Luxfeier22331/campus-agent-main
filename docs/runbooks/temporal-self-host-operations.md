---
doc_type: runbook
truth_scope: ops
owner_boundary: temporal-platform
status: active
created: 2026-07-03
updated: 2026-07-13
---
# Temporal Operations

## Platform Baseline

- Temporal Server `>= 1.29.1`
- Temporal Worker Controller `>= 1.8.0`
- KEDA `>= 2.20`
- cert-manager available to the WorkerResourceTemplate webhook

Worker Controller must be installed before runtime WorkerDeployments. Its Helm
allowed-resource list must include KEDA `ScaledObject` and policy/v1
`PodDisruptionBudget`; the controller and GitOps principal need RBAC for both.

## Ownership

- Argo CD: platform charts, Connections, WorkerDeployments,
  WorkerResourceTemplates, ConfigMaps, Secrets, image digests, and sync order.
- Temporal: workflow history, task routing, retry, timeout, heartbeat,
  cancellation, and Worker Deployment version routing.
- KEDA/HPA: replicas for each active worker build.
- Applications: deterministic workflow/activity code and bounded projections.

Workflows never call Argo CD or Kubernetes. A deployment never rewrites
workflow history or product projections.

## Change Procedure

1. Confirm Temporal/KEDA/Worker Controller versions satisfy the baseline.
2. Render source and environment Kustomize overlays.
3. Run kubeconform with custom-resource schemas skipped or supplied.
4. Select immutable image digests in GitOps.
5. Let Argo CD apply the new WorkerDeployment pod template.
6. Watch the target build register pollers and become current.
7. Confirm old builds drain and their generated resources follow sunset policy.

Do not patch controller-created version Deployments directly. Change the parent
WorkerDeployment template and let the controller reconcile.

## Status

```bash
kubectl get connection
kubectl get workerdeployment -o wide
kubectl get workerresourcetemplate
kubectl get deployment,scaledobject,poddisruptionbudget
```

For each WorkerDeployment verify:

- Ready/Progressing conditions;
- target and current Build IDs;
- registered task queues and pollers;
- generated Deployment availability;
- generated ScaledObject/HPA health;
- generated PDB selector;
- deprecated build drain status.

## Common Failures

`WaitingForPollers`:

- inspect worker startup;
- verify both version variables are injected;
- verify SDK versioning is enabled;
- verify task queue and namespace;
- verify `minReplicaCount` did not prevent bootstrap.

WorkerResourceTemplate rejected:

- verify allowed-resource Helm values;
- verify webhook TLS/cert-manager;
- verify the applying principal and controller RBAC;
- leave controller-owned target/selector fields as `{}`.

KEDA metric failure:

- verify KEDA 2.20+;
- verify Temporal endpoint and namespace;
- verify task queue and `queueTypes`;
- verify the `workerDeployment*FromEnv` fields resolve from the target pod.

Version does not drain:

- inspect open pinned workflows and task queues in Temporal;
- do not force-delete the old Deployment while workflows remain;
- cancel/terminate workflows only according to product or ingestion policy.

## Rollback

Rollback means selecting a known image/config pod template in GitOps. Worker
Controller creates or selects the resulting build and Temporal routes new work
according to the declared rollout. Do not reuse a Build ID for incompatible
workflow code and do not manually edit Temporal routing behind the controller.

## Persistence

Temporal persistence and visibility databases are platform data. Backups,
restore, schema upgrades, and retention use Temporal/CNPG procedures and never
share application schema migration jobs.

## Related Documents

- `docs/decisions/adr-0078-worker-versioning.md`
- `docs/architecture/system/k8s-runtime.md`
- `docs/runbooks/ingestion.md`
