---
doc_type: reference
truth_scope: ops
owner_boundary: infra/gitops
status: active
created: 2026-07-03
updated: 2026-07-06
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
- `secrets/` owns Kubernetes secret delivery contracts. It may contain
  External Secrets references, SealedSecret resources, SOPS-encrypted Secret
  manifests or backend-specific examples after a deployment selects a delivery
  path, but never plaintext secret material.
- First-party workload Applications point to the reviewed Kustomize overlays
  named in `infra/gitops/apps/*.yaml`. The current execution-runtime staging
  Application uses
  `infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full`.
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
- `platform-sealed-secrets`: Bitnami Sealed Secrets Helm chart, the recommended
  default self-hosted/open-source GitOps secret delivery controller.
- `platform-external-secrets`: optional External Secrets Operator Helm chart
  for deployments that choose an external secret manager backend.
- `platform-cloudnativepg`: CloudNativePG operator Helm chart.
- `data-postgres-staging`: CNPG-managed Postgres cluster, roles and databases.
- `data-qdrant-staging`: Qdrant Helm chart with platform-owned server Secrets.
- `platform-temporal-staging`: Temporal Helm chart with external CNPG
  databases and UI disabled by default.
- `platform-temporal-alias-staging`: stable same-namespace `temporal:7233`
  Service alias for first-party execution-control and workers. KEDA scalers use
  `temporal.campus-agent-staging.svc.cluster.local:7233` because the KEDA
  operator resolves DNS from the `keda` namespace.
- `observability-otel-collector-staging`: OpenTelemetry Collector Helm chart.
- `memory-hindsight-staging`: Hindsight API Helm chart with external providers,
  external Postgres and UI/control-plane/worker disabled by default.
- `ingress-traefik-staging`: Traefik Helm chart with the non-default
  `traefik-staging` ingress class.
- `execution-runtime-staging`: nc-arm-6c first-party execution-control /
  agent-runtime / Temporal worker plane Kustomize overlay.
- `dining-sync-staging`: dining sync CronJob Kustomize overlay.

## Bootstrap Order

1. Install Argo CD into the target cluster.
2. Select a Kubernetes secret delivery path. For repo-supported self-hosted
   GitOps, apply `infra/gitops/apps/platform-sealed-secrets.yaml`, back up the
   controller sealing key and seal the required role-scoped Secrets. Small
   installs may still create the required Kubernetes Secrets manually from
   operator-owned runbooks; deployments with an external secret manager may
   apply `infra/gitops/apps/platform-external-secrets.yaml`; deployments using
   SOPS must install their chosen decrypt integration before syncing encrypted
   secret resources.
3. Apply only `infra/gitops/apps/platform-keda.yaml` and wait for KEDA
   CRDs/controllers to become ready.
4. Apply `infra/gitops/apps/platform-cloudnativepg.yaml` and wait for CNPG
   CRDs/controllers to become ready.
5. Ensure the required role-scoped Kubernetes Secrets exist before workloads
   that consume them are synced. If the deployment uses a GitOps secret
   backend, add the reviewed encrypted/reference manifests under `secrets/`.
6. Apply `infra/gitops/apps/data-postgres-staging.yaml` and wait for the CNPG
   cluster/databases to become ready.
7. Apply platform Applications for Qdrant, Temporal, Temporal alias, OTel,
   Hindsight and Traefik.
8. Confirm first-party execution-runtime Secrets and provider projection
   resources exist through the selected secret-delivery path, then apply
   `execution-runtime-staging` and other first-party Applications.

Do not install KEDA, Sealed Secrets, External Secrets Operator, CNPG, Qdrant,
Temporal, OTel, Hindsight or Traefik manually with `helm install` once Argo CD
owns the corresponding Application. Argo CD is the lifecycle owner; Helm is
only the renderer for third-party charts. OCI Helm charts use the Argo CD
`repoURL` without the `oci://` prefix.

`data-qdrant-staging` disables the upstream Helm test hook because that hook
expects API keys to be present as Helm values. The repo-owned Qdrant posture is
Secret-backend material rendered into `qdrant-server-secrets/local.yaml` and
mounted into the pod; readiness and runtime smoke are the accepted validation
surfaces.
