---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-07-06
---

# Execution Control Staging Operations

## Boundary

Execution-control staging operations are Kubernetes/GitOps-owned. Docker Compose
is local diagnostics only and must not own staging lifecycle.

Related owner docs:

- current topology: `../architecture/current.md`
- K8s runtime architecture: `../architecture/system/k8s-runtime.md`
- GitOps operations: `gitops-k8s.md`
- product-path smoke: `execution-smoke.md`

## Deploy And Status

Use Argo CD as the lifecycle owner:

```bash
argocd app sync platform-cloudnativepg
argocd app sync data-postgres-staging
argocd app sync data-qdrant-staging
argocd app sync platform-temporal-staging
argocd app sync platform-temporal-alias-staging
argocd app sync observability-otel-collector-staging
argocd app sync memory-hindsight-staging
argocd app sync ingress-traefik-staging
argocd app sync execution-runtime-staging
argocd app wait execution-runtime-staging --health --sync
```

Check first-party runtime readiness with Kubernetes primitives:

```bash
kubectl -n campus-agent-staging rollout status deploy/execution-control
kubectl -n campus-agent-staging rollout status deploy/agent-runtime
kubectl -n campus-agent-staging rollout status deploy/workflow-worker
kubectl -n campus-agent-staging rollout status deploy/activity-worker-core
kubectl -n campus-agent-staging rollout status deploy/activity-worker-agent
kubectl -n campus-agent-staging rollout status deploy/activity-worker-knowledge
kubectl -n campus-agent-staging get pods,svc,ingress
```

## Config And Secrets

Non-secret bootstrap config is tracked in Kustomize/Helm values and delivered as
Kubernetes ConfigMaps. Secret material is delivered through the selected
Kubernetes Secret backend: manual Secrets, Sealed Secrets, External Secrets
Operator or SOPS-backed encrypted Secrets.

Provider active profiles remain app-api provider-config truth. Runtime consumers
use the reviewed provider projection artifact delivered through the selected
Secret/file delivery path. Missing Secrets, ConfigMaps or projections are
deployment blockers.

## Health And Triage

Use Kubernetes probes, events and logs:

```bash
kubectl -n campus-agent-staging get events --sort-by=.lastTimestamp
kubectl -n campus-agent-staging logs deploy/execution-control --tail=200
kubectl -n campus-agent-staging logs deploy/activity-worker-knowledge --tail=200
kubectl -n campus-agent-staging describe deploy/execution-control
```

Public readiness is still observed through app-api:

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
curl --noproxy '*' -sS -i https://campus-staging.mucwiki-edge.link/readyz
```

If execution-control readiness is degraded, inspect the owning platform
Application first: Temporal, Hindsight, Qdrant, OTel, Postgres or the
first-party execution-runtime Application. Do not add Docker staging scripts or
local env renderers as a workaround.

## Rollback

Rollback is GitOps rollback, not Docker Compose restart:

```bash
argocd app history execution-runtime-staging
argocd app rollback execution-runtime-staging <revision>
argocd app wait execution-runtime-staging --health --sync
```

If a platform Application caused the regression, roll back that Application
separately and record the affected dependency in the closeout artifact.
