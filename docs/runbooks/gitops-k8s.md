---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-07-03
updated: 2026-07-16
---
# Kubernetes GitOps Runbook

## Purpose

This runbook defines the handoff between this application repository and an
operator-owned Kubernetes environment repository. It does not contain the
coordinates or commands for a specific private cluster.

ADR-0074 is the ownership decision. The source repository is not Kubernetes
deployment truth.

This runbook also records the handoff to Cloudflare Terraform, but Argo CD
continues to own Kubernetes only.

## Repository Ownership

This repository owns:

- namespace-neutral bases under `infra/k8s/*/base`;
- workload references to stable ConfigMap and Secret names;
- first-party image build, scan and immutable SHA-tag publication;
- the workflow that proposes immutable deployment inputs through a GitOps pull
  request.

The environment repository owns:

- Argo CD root and child Applications;
- namespaces, Kustomize overlays and cluster-specific NetworkPolicies;
- third-party chart versions and Helm values;
- deployment ConfigMaps, registry pull credentials, SealedSecrets and trust
  anchors;
- full source commit SHAs and first-party image digests;
- Cloudflare Terraform state, non-secret platform resources and Worker version
  selection;
- environment-specific rollout, recovery and cluster verification.

The self-hosted object store follows the same split: this repository owns the
namespace-neutral StatefulSet, Service, bootstrap Job and NetworkPolicy base;
the environment repository owns storage class, SealedSecret values, source SHA
and Argo CD Application. The object store is private ClusterIP-only data-plane
infrastructure and must not gain a public ingress for migration convenience.

Do not copy environment files back into this repository. Other institutions
should fork the source and create their own environment repository.

## Bootstrap

1. Install Argo CD and the selected secret-delivery controller in the target
   cluster.
2. Install a read-only GitHub App on the source and environment repositories.
3. Store one Argo CD `repo-creds` Secret whose URL is the narrow organization
   or owner prefix shared by those repositories.
4. Create all reviewed encrypted secret resources in the environment
   repository. Workloads must not start while required Secrets are absent.
5. Apply the environment repository's root Application once.
6. Confirm every child Application reports `Synced` and `Healthy` before
   treating the cluster as usable.

The environment root Application should enable automated sync, prune and
self-heal. `CreateNamespace=true` is an environment choice; reusable bases do
not create Namespaces.

## Image Promotion

On a successful `main` candidate build,
`.github/workflows/execution-runtime-publish.yml`:

1. publishes affected `execution-control`, `agent-runtime`, `ingestion-control`,
   `ingestion-control-worker`, `source-collector`, `app-api-schema`, `ops-web`
   and `transport-publisher` ARM64 images with only the source commit SHA as a
   tag, and uploads affected Worker versions without changing traffic;
2. records image and Worker entries already declared by the environment
   repository; an image without a consumer remains a published candidate, while
   an explicit manual promotion requires every selected image to have a consumer;
3. authenticates as a dedicated GitHub App limited to the environment
   repository;
4. updates the environment's source-base SHA, image digests, runtime release id
   and Worker version manifest;
5. renders every environment Kustomize target; and
6. opens or updates one pull request for that source commit.

The workflow never writes directly to environment `main`. Merging the GitOps
pull request lets Argo CD reconcile Kubernetes and Terraform reconcile
Cloudflare. The environment repository owns their ordering and health gates.

Publishing an image does not make it active. The environment repository must
declare its immutable digest and Application before Argo CD can deploy it.

## Secret Delivery

Workloads depend only on stable Kubernetes Secret names and keys. Sealed
Secrets is the recommended small self-hosted default, while External Secrets
Operator, SOPS or manual Secrets remain deployment choices under ADR-0066.

For Sealed Secrets:

- use strict scope;
- keep plaintext input, controller keys, certificates and kubeconfigs outside
  git;
- store ciphertext only in the private environment repository;
- verify that each SealedSecret produces the expected Secret type and key names
  without printing values.

Cloudflare Worker secrets remain in the Cloudflare secret store and are not
mirrored into Kubernetes.

Ops Web uses the stable Secret names documented by its base. The environment
change must remain a draft until dedicated OpenObserve write, read and
maintenance credentials exist and are sealed for their exact target names and
namespace. Do not use the OpenObserve root account or commit placeholder
credentials to make an overlay render.

## Schema Ownership

The environment execution overlay owns an Argo CD `PreSync` Job for run
projection schema installation. The Job uses the same immutable
`execution-control` image digest as the runtime, retries only within a bounded
deadline for Pod network readiness and fails the sync when schema installation
does not succeed.

Long-running execution-control processes keep
`EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE=false`. They do not become schema
owners.

Before enabling Ops Web, the environment operator must apply and verify the
`ops_web` and `ops_audit_maintenance` grants through
`apps/app-api/ops/db/ops-web-database.ts`. The Ops Web runtime account has
column-scoped reads and audit insert only; the maintenance account can execute
only the fixed 180-day pruning function.

## Verification

In the environment repository, validate before merge:

```bash
kubectl kustomize clusters/<environment>/applications >/dev/null
kubectl kustomize clusters/<environment>/secrets >/dev/null
for overlay in clusters/<environment>/overlays/*; do
  kubectl kustomize "$overlay" >/dev/null
done
```

Also render every pinned upstream Helm chart with its environment values, scan
the repository with Gitleaks and reject mutable first-party image tags or
branch-based source bases.

After merge, cluster evidence must include:

- the root and all child Applications at the expected environment commit;
- all Applications `Synced` and `Healthy`;
- successful schema PreSync output with `passed=true`, `schema_ready=true` and
  `store=postgres`;
- first-party Deployments using the reviewed image digests;
- if Ops Web is selected, authenticated `/readyz`, page shell and one
  `/api/ops/overview` response through the configured Access envelope;
- authenticated execution-control readiness and the relevant product smoke.

Committed manifests or successful source CI alone are not deployment evidence.

## Failure Handling

- Repository authentication failure: fix the read-only GitHub App installation
  or prefix-scoped `repo-creds`; do not add deploy keys or personal tokens.
- Kustomize or Helm render failure: fix the environment pull request; do not
  force sync invalid desired state.
- SealedSecret failure: verify strict name/namespace binding and controller
  ownership without exposing plaintext.
- PreSync failure: inspect the Job and dependency readiness; do not bypass the
  schema gate.
- Degraded workload: use Application status, Pod events and authenticated
  readiness output to identify the failed dependency before retrying sync.
