---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-07-03
updated: 2026-07-06
---
# K8s GitOps Runbook

## Boundary

This runbook is the operational entry for K8s/GitOps-owned staging. Legacy
Docker staging lifecycle, bridge overlays and local runtime env renderers are
retired.

## Preflight

Before applying any Argo CD Application:

```bash
pnpm repo:static
kubectl kustomize infra/k8s/execution-runtime/overlays/staging
kubectl kustomize infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full
kubectl kustomize infra/k8s/data-postgres/overlays/nc-arm-6c-staging
kubectl kustomize infra/k8s/platform-temporal/overlays/nc-arm-6c-staging
kubectl kustomize infra/k8s/dining-sync/overlays/staging
```

The GitOps static check must pass before using `infra/gitops/apps/*.yaml`.

The first K8s staging profile is non-HA by default. Do not use this skeleton as
production closeout material until a separate production overlay or Application set has
accepted HA sizing, backup, ingress, Access and release gates.

## nc-arm-6c K8s Platform Staging

K8s platform staging runs third-party platform dependencies through separate
GitOps Applications, while `execution-runtime-staging` remains first-party
runtime only.

Platform/data Applications:

- `platform-cloudnativepg`
- `data-postgres-staging`
- `data-qdrant-staging`
- `platform-temporal-staging`
- `platform-temporal-alias-staging`
- `observability-otel-collector-staging`
- `memory-hindsight-staging`
- `ingress-traefik-staging`

First-party Application:

- `execution-runtime-staging`

The first-party full overlay uses
`infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full` and must not
include host-bridged `EndpointSlice` resources, `hostPort` on
`execution-control`, StatefulSets or platform-owned Deployments.

Ensure the selected secret-delivery path has reconciled first-party runtime
Secrets, the provider projection Secret and the `mucwiki-edge-origin-tls`
Ingress TLS Secret before server-side dry-run:

```bash
kubectl apply -k infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full \
  --dry-run=server
```

Before applying through Argo CD, render the first-party overlay and platform
Helm values locally:

```bash
kubectl kustomize infra/k8s/execution-runtime/overlays/nc-arm-6c-staging-full
pnpm repo:static
```

The Traefik controller is Helm-managed. Shadow mode binds `18080/18443`, so it
can be installed while Docker Traefik still owns `80/443`. After Argo CD owns
the Application, use Argo CD sync rather than direct `helm upgrade`; direct Helm
rendering is for preflight only:

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update traefik
helm template traefik-staging traefik/traefik \
  --version 41.0.1 \
  --namespace ingress-system \
  -f infra/gitops/values/traefik/nc-arm-6c-shadow.yaml
```

Shadow route proof uses the real host header against `18443`:

```bash
curl -k --resolve execution-control-staging.mucwiki-edge.link:18443:127.0.0.1 \
  https://execution-control-staging.mucwiki-edge.link:18443/healthz
```

Cutover to `80/443` requires a backup and reversible stop point:

1. Snapshot Docker volumes / bind mounts for Postgres, Temporal Postgres,
   Hindsight Postgres and Qdrant before any restore into PVCs.
2. Stop only the Docker containers being replaced by full K8s.
3. Sync platform/data Applications and wait for CNPG, Qdrant, Temporal,
   Hindsight and OTel readiness.
4. Sync `execution-runtime-staging` and wait for first-party runtime readiness.
5. Switch Traefik values to `infra/gitops/values/traefik/nc-arm-6c-cutover.yaml`
   through the GitOps Application.
6. Run staging chat E2E and operator projection closeout.

Do not apply cutover values while Docker Traefik still binds `80/443`.

## Bootstrap

1. Install Argo CD into the target cluster namespace `argocd`.
2. Select and prepare one Kubernetes secret delivery path:
   - manual Kubernetes Secrets for small self-hosted installs;
   - `infra/gitops/apps/platform-sealed-secrets.yaml` as the recommended
     self-hosted/open-source GitOps path;
   - `infra/gitops/apps/platform-external-secrets.yaml` only when an external
     secret manager backend is selected;
   - SOPS only when its decrypt integration and key lifecycle are owned by the
     deployment.
3. Ensure the required role-scoped Kubernetes Secrets exist, or that the chosen
   GitOps secret delivery resources will create them before dependent
   workloads sync.
4. Apply `infra/gitops/apps/platform-keda.yaml`.
5. Wait for KEDA CRDs and controller pods to become ready.
6. Apply `infra/gitops/apps/platform-cloudnativepg.yaml`.
7. Wait for CloudNativePG CRDs and controller pods to become ready.
8. Add reviewed secret delivery references or encrypted secret manifests under
   `infra/gitops/secrets/` only for the chosen backend.
9. Apply `infra/gitops/apps/data-postgres-staging.yaml` and wait for the CNPG
   cluster, roles and databases to become ready.
10. Apply platform Applications:
   `infra/gitops/apps/data-qdrant-staging.yaml`,
   `infra/gitops/apps/platform-temporal-staging.yaml`,
   `infra/gitops/apps/platform-temporal-alias-staging.yaml`,
   `infra/gitops/apps/observability-otel-collector-staging.yaml`,
   `infra/gitops/apps/memory-hindsight-staging.yaml` and
   `infra/gitops/apps/ingress-traefik-staging.yaml`.
11. Confirm first-party execution-runtime Secrets and provider projection file
   are present through the selected secret-delivery path.
12. Apply `infra/gitops/apps/execution-runtime-staging.yaml` and
   `infra/gitops/apps/dining-sync-staging.yaml`.

Do not use `helm install` or `helm upgrade` directly for KEDA, External Secrets
Operator, Sealed Secrets, CNPG, Qdrant, Temporal, OTel, Hindsight or Traefik
after Argo CD owns the corresponding Application. The chart inputs live in Git;
Argo CD renders Helm and owns lifecycle, sync and drift detection.

This runbook intentionally does not prescribe a concrete secret backend. The
workload contract is stable Kubernetes Secret names; backend selection can be
manual Secrets, Sealed Secrets, External Secrets Operator or SOPS-backed
encrypted Secrets without changing first-party Deployment/CronJob consumption.
For repo-supported self-hosted GitOps, Sealed Secrets is the recommended
default.

## Retired Local Renderers

Execution-runtime env renderers that emit ConfigMap or Secret YAML from local
env files are retired. Do not recreate `kubectl create ... --from-env-file`
helpers for first-party runtime config or secrets. Kustomize owns tracked
non-secret bootstrap config, and the selected Secret delivery backend owns
Secret material and projected runtime artifacts.

## Sealed Secrets Operations

Install the controller through Argo CD:

```bash
kubectl apply -f infra/gitops/apps/platform-sealed-secrets.yaml
kubectl -n kube-system rollout status deploy/sealed-secrets-controller
```

Install the `kubeseal` client from the Bitnami Sealed Secrets release or a
trusted package manager. The repo chart values keep the controller name
`sealed-secrets-controller` in `kube-system`, matching `kubeseal` defaults.

Fetch and pin the public certificate used for offline sealing:

```bash
kubeseal --fetch-cert > sealed-secrets-nc-arm-6c.pem
```

The certificate is public, but operators must still verify it came from the
intended cluster. Do not commit local plaintext Secret inputs or private
sealing keys.

Seal one role-scoped Secret for its exact target namespace and name:

```bash
kubeseal \
  --format yaml \
  --cert sealed-secrets-nc-arm-6c.pem \
  < secret.local.yaml \
  > infra/gitops/secrets/execution-control-secrets.sealedsecret.yaml
```

The default Sealed Secrets scope is strict. Keep it strict: do not pass
`--scope namespace-wide` or `--scope cluster-wide`, and do not commit
`sealedsecrets.bitnami.com/namespace-wide`,
`sealedsecrets.bitnami.com/cluster-wide` or equivalent
`sealedsecrets.bitnami.com/scope` annotations.

Validate a sealed manifest before review:

```bash
kubeseal --validate < infra/gitops/secrets/execution-control-secrets.sealedsecret.yaml
pnpm repo:static
```

Back up the controller sealing key out of band before relying on committed
SealedSecret resources:

```bash
kubectl -n kube-system get secret -l sealedsecrets.bitnami.com/sealed-secrets-key \
  -o yaml > sealed-secrets-key.backup.yaml
```

Store that backup in the deployment's secret backup system, not in git. Restore
uses the same namespace and Secret label before the controller starts; after
restore, restart the controller and validate that existing SealedSecret
resources still reconcile. Rotation is a deployment operation: generate or
allow a new sealing key, update the offline certificate, reseal reviewed
SealedSecret manifests and keep the previous key until all active resources
have been resealed and reconciled.

Do not commit the local plaintext input Secret, fetched certificate or sealing
key backup. `.gitignore` covers the runbook examples, and
`pnpm repo:static` rejects obvious local/backup manifests under
`infra/gitops/secrets/`.

## Temporal Helm Operations

`platform-temporal-staging` uses the pinned Temporal Helm chart with external
CNPG databases. CNPG owns creation of the `temporal` and
`temporal_visibility` databases; Temporal Helm sets `createDatabase: false` and
`manageSchema: true`, so the chart only installs/updates Temporal schema.

The Temporal schema Job is rendered as a Helm hook. Do not add Argo CD native
hook annotations to the same Application or its sibling alias Application;
Argo CD ignores Helm hooks when Argo CD hooks are present in that app. The
Application also sets `helm.skipTests: true` so the chart test Pod is not part
of desired state. Runtime health must be proven through readiness and Temporal
runtime proof commands, not Helm test hooks.

Hindsight UI/control-plane/worker and Temporal UI are disabled by default. They
may be enabled temporarily by a reviewed values change or an operator-owned
script for diagnostics; they are not part of always-on online serving.

Qdrant's upstream Helm test hook is disabled in the Argo CD Application because
it expects API keys as Helm values. This repo expects the chosen secret
delivery path to produce `qdrant-server-secrets/local.yaml`, which is mounted
into the Qdrant pod; Qdrant validation must use Kubernetes readiness and runtime
smoke, not the chart's values-driven test hook.

CloudNativePG pgvector ImageVolume usage requires PostgreSQL 18+, Kubernetes
1.35+ or ImageVolume feature gate enabled on Kubernetes 1.33/1.34, and a
container runtime with ImageVolume support such as containerd 2.1+ or CRI-O
1.31+. Verify the actual nc-arm-6c cluster server version and runtime before
syncing `data-postgres-staging`.

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
- `platform-keda` and `platform-cloudnativepg` sync successfully; if the
  deployment selected External Secrets Operator, `platform-external-secrets`
  also syncs successfully.
- `data-postgres-staging`, `data-qdrant-staging`,
  `platform-temporal-staging`, `platform-temporal-alias-staging`,
  `observability-otel-collector-staging`, `memory-hindsight-staging` and
  `ingress-traefik-staging` sync successfully.
- `execution-runtime-staging` syncs and all pods pass readiness.
- app-api staging points to the K8s execution-control ingress/service.
- A real staging chat closeout and runtime projection closeout artifact have passed.
