---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-07-03
updated: 2026-07-04
---
# K8s GitOps Runbook

## Boundary

This runbook is the operational entry for the target K8s GitOps skeleton. It
does not replace the current Docker staging runbooks until K8s staging is
actually serving traffic and has E2E evidence.

## Preflight

Before applying any Argo CD Application:

```bash
pnpm repo:static
kubectl kustomize infra/k8s/execution-runtime/overlays/staging
kubectl kustomize infra/k8s/dining-sync/overlays/staging
```

The GitOps static check must pass before using `infra/gitops/apps/*.yaml`.

The first K8s staging profile is non-HA by default. Do not use this skeleton as
production evidence until a separate production overlay or Application set has
accepted HA sizing, backup, ingress, Access and release gates.

## Bootstrap

1. Install Argo CD into the target cluster namespace `argocd`.
2. Apply `infra/gitops/apps/platform-external-secrets.yaml`.
3. Wait for External Secrets Operator CRDs and controller pods to become ready.
4. Apply `infra/gitops/apps/platform-keda.yaml`.
5. Wait for KEDA CRDs and controller pods to become ready.
6. Add reviewed `ExternalSecret` / `SecretStore` references under
   `infra/gitops/secrets/` after the backend is selected.
7. Apply `infra/gitops/apps/execution-runtime-staging.yaml` and
   `infra/gitops/apps/dining-sync-staging.yaml`.

Do not use `helm install` or `helm upgrade` directly for KEDA or External
Secrets after Argo CD owns the Applications. The chart inputs live in Git; Argo
CD renders Helm and owns lifecycle, sync and drift detection.

This runbook intentionally does not prescribe the concrete external secret
backend. The workload contract is stable Kubernetes Secret names; the backend
selection can be added later without changing first-party Deployment/CronJob
consumption.

## Ownership Checks

- Argo CD Applications must point only to tracked repo paths or pinned
  third-party Helm charts.
- Helm values must be non-secret deployment parameters.
- `infra/gitops/secrets/` may contain external secret references only after
  backend selection; it must not contain secret values.
- External provider active profiles must be configured through app-api
  provider-config, then exported as explicit runtime projections.
- Worker secrets must be checked with Worker deploy/preflight tooling, not
  mirrored into K8s.

## Promotion Rule

Do not describe K8s/Argo CD as live staging truth until these are all true:

- Argo CD is installed in the target cluster.
- `platform-keda` and `platform-external-secrets` sync successfully.
- `execution-runtime-staging` syncs and all pods pass readiness.
- app-api staging points to the K8s execution-control ingress/service.
- A real staging chat proof and runtime projection evidence have passed.
