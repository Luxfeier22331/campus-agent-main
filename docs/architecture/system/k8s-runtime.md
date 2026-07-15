---
doc_type: architecture
truth_scope: system
owner_boundary: temporal-worker-runtime
status: active
created: 2026-07-03
updated: 2026-07-14
---
# Kubernetes Runtime

## Boundary

This document defines repository-owned Kubernetes bases for Temporal workers.
Environment repositories own Argo CD Applications, namespaces, immutable image
digests, Helm values, encrypted secrets, and environment-specific patches.

## Runtime Bases

`infra/k8s/execution-runtime/base` contains:

- execution-control and agent-runtime Services/Deployments;
- `execution-workflow`, `execution-core`, and `execution-agent`
  WorkerDeployments;
- per-version KEDA ScaledObjects and PDBs;
- the Temporal Connection, private connector, ServiceAccount, and network
  policy resources.

`infra/k8s/ingestion-runtime/base` contains:

- ingestion-control Service/Deployment;
- `ingestion-control-worker` and `source-collector-worker`
  WorkerDeployments;
- per-version KEDA ScaledObjects and PDBs;
- the Temporal Connection, ServiceAccount, and network policy resources.

## Platform Prerequisites

- Temporal Server `>= 1.29.1`
- Temporal Worker Controller `>= 1.8.0`
- KEDA `>= 2.20`
- cert-manager for the WorkerResourceTemplate validating webhook

Worker Controller Helm values must allow the two templated resource kinds:

```yaml
workerResourceTemplate:
  allowedResources:
    - kinds: ["ScaledObject"]
      apiGroups: ["keda.sh"]
      resources: ["scaledobjects"]
    - kinds: ["PodDisruptionBudget"]
      apiGroups: ["policy"]
      resources: ["poddisruptionbudgets"]
```

The user applying a WorkerResourceTemplate and the controller ServiceAccount
must also have permission to manage the embedded resource kind.

## Versioning

Worker Controller hashes the pod template, creates a Kubernetes Deployment per
build, and injects:

- `TEMPORAL_DEPLOYMENT_NAME`
- `TEMPORAL_WORKER_BUILD_ID`

Go and TypeScript workers require both variables together, enable Temporal
Worker Deployment Versioning, and use `PINNED` as the default behavior. Local
workers may omit both variables. A partially configured pair fails startup.

The base rollout strategy is `AllAtOnce`. Old versions remain available for
pinned work until Temporal reports them drained; the sunset policy scales them
down after one hour and deletes their Kubernetes Deployment after 24 hours.
Argo CD must not prune controller-created version Deployments independently.

## Autoscaling

WorkerResourceTemplate creates one ScaledObject per active worker build and
injects its `scaleTargetRef`. KEDA reads Temporal backlog directly and resolves
the deployment/build identity from the target worker environment. No
application process, database projection, or custom autoscaler participates.

All worker pools use `minReplicaCount: 1`. This lets a new build start a poller,
register its Worker Deployment version, and become current. Scale-to-zero is not
the default because it can deadlock initial version registration.

Execution pools scale independently by their workflow/core/agent queues.
The ingestion-control worker uses three triggers on one versioned Deployment
because one process polls workflow, control, and Rust-kernel queues. The source
collector scales on its activity queue with a target backlog of one.
Source-collector and Rust-kernel activity workers execute at most one activity
per Pod. Browser and native-kernel concurrency therefore grows through KEDA
replicas instead of unbounded in-process activity slots; workflow and bounded
PostgreSQL control activities use fixed higher slot limits.

SDK shutdown grace stays below the Pod termination grace: 50 seconds for Go
execution workers and ingestion-control, and 80 seconds for source-collector.
This gives the SDK time to stop polling and drain or cancel active activities
while leaving Kubernetes enough time to terminate the process cleanly.

## Desired State

Argo CD owns:

- Connection, WorkerDeployment, and WorkerResourceTemplate desired state;
- immutable first-party image digests;
- environment ConfigMaps, Secrets, schema jobs, and network patches;
- platform chart versions and sync ordering.

Temporal owns workflow/activity history and version routing. KEDA/HPA owns
replica count. PostgreSQL stores only product or ingestion projections. A
workflow must never deploy, restart, or mutate its own worker resources.

Apply order is:

1. Temporal Server and namespace;
2. KEDA and Worker Controller CRDs/controller/webhooks;
3. encrypted secrets and database schema jobs;
4. runtime Connections, APIs, WorkerDeployments, and WorkerResourceTemplates.

## Networking And Secrets

Repository bases default-deny ingress and egress, then permit DNS and required
Temporal, PostgreSQL, object-store, OTLP, provider HTTPS, and private-service
traffic. Environment overlays narrow endpoints and add private connector/VPC
bindings. Browser clients never connect directly to Temporal, workers,
PostgreSQL, or object storage.

Database, object-store, provider, telemetry, memory, and internal API secrets
remain separate. Worker Controller version variables are generated runtime
identity, not user-managed secrets.

## Image Lanes

- pull requests: `pr / image-scan` builds and scans affected runtime images;
- main and manual publication: `execution-runtime-publish` publishes managed
  immutable runtime image candidates.

The ingestion lanes produce `ingestion-control`, `ingestion-control-worker`,
and `source-collector`. The API image excludes the Rust runner and tokenizer;
the ingestion worker image owns both. The source collector image contains only
the Chromium headless shell used by its Temporal activities. These images are
not part of automatic execution-runtime publication until the environment
repository declares their consumers.

The PR lane builds, exercises the ingestion runtime contracts, and scans
affected images. The main publish lane attaches an OCI SBOM, scans the ARM64
target, and pushes ARM64 images for the current environment consumers. GitOps
promotion selects digests; a mutable tag is never deployment truth. Ingestion
and Ops Web images remain outside this publication lane until the environment
repository declares their consumers.

## Verification

```bash
kubectl kustomize infra/k8s/execution-runtime/base
kubectl kustomize infra/k8s/ingestion-runtime/base
kubeconform -strict -ignore-missing-schemas rendered.yaml
```

Cluster verification checks WorkerDeployment status, current/target build IDs,
WorkerResourceTemplate status, generated Deployments/ScaledObjects/PDBs, KEDA
conditions, Temporal pollers, and draining versions.

## Forbidden Shapes

- static Deployments for Temporal workers;
- static ScaledObjects tied to a single worker Deployment;
- custom task-queue samplers or replica actuators;
- workflow code that calls Kubernetes or Argo CD;
- user-maintained Worker build IDs;
- unversioned production pollers.

## Related Documents

- `docs/decisions/adr-0078-worker-versioning.md`
- `docs/runbooks/temporal-self-host-operations.md`
- `docs/architecture/system/durable-runtime.md`
- `docs/architecture/system/data-plane.md`
