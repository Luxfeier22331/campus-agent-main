---
doc_type: reference
truth_scope: ops
owner_boundary: infra/gitops
status: active
created: 2026-07-03
updated: 2026-07-04
---
# GitOps Skeleton

This directory contains the target Argo CD desired-state skeleton for
Kubernetes-managed `campus-agent` runtime components.

It is not evidence that the current nc-arm-6c staging runtime has been migrated
to Kubernetes. Live substrate truth must come from applied resources, runtime
env, projection and E2E evidence.

## Ownership

- `apps/` owns Argo CD `Application` manifests.
- `values/` owns non-secret Helm values for third-party platform charts.
- `secrets/` owns the target External Secrets Operator delivery contract. It
  may contain external secret references after the backend is selected, but
  never real secret material.
- First-party workloads point to existing Kustomize overlays under
  `infra/k8s/**/overlays/staging`.
- Third-party platform components may use pinned upstream Helm charts. When a
  chart comes from a Helm repository, values files are sourced from this repo
  through Argo CD multiple sources and `$values/...` references.

## Boundaries

- Argo CD manages Kubernetes desired state only.
- Cloudflare Worker deploys, Worker vars/secrets, Hyperdrive bindings and
  Cloudflare Access policy stay outside Argo CD.
- `apps/app-api` provider-config owns external model/search provider active
  profiles. GitOps manifests and Helm values must not contain provider API keys
  or active-profile decisions.
- Real secret material belongs to external secret stores or deploy-side secret
  stores, never to this directory.

## Initial Applications

- `platform-keda`: KEDA Helm chart, required by Temporal worker autoscaling.
- `platform-external-secrets`: External Secrets Operator Helm chart, target
  K8s secret delivery layer.
- `execution-runtime-staging`: first-party execution-control / Temporal worker
  plane Kustomize overlay.
- `dining-sync-staging`: dining sync CronJob Kustomize overlay.

## Bootstrap Order

1. Install Argo CD into the target cluster.
2. Apply only `infra/gitops/apps/platform-external-secrets.yaml` and wait for
   External Secrets Operator CRDs/controllers to become ready.
3. Apply only `infra/gitops/apps/platform-keda.yaml` and wait for KEDA
   CRDs/controllers to become ready.
4. Add reviewed external secret references under `secrets/` after the external
   backend is selected.
5. Apply first-party Applications.

Do not install KEDA or External Secrets manually with `helm install` once Argo
CD owns these Applications. Argo CD is the lifecycle owner; Helm is only the
renderer for third-party charts.
