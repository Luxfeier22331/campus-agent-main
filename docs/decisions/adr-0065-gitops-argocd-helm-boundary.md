---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0065
status: accepted
created: 2026-07-03
updated: 2026-07-13
---
# ADR-0065 GitOps Argo CD And Helm Boundary

## Context

ADR-0078 supersedes ADR-0056 and accepts Temporal Worker Controller + KEDA as
the production worker substrate for the
execution runtime, but it intentionally did not decide Helm vs Kustomize vs raw
manifests. The repository now needs a durable deployment-management boundary
before K8s staging is promoted from target manifests into live operations.

## Decision

Adopt Argo CD as the target Kubernetes desired-state reconciler.

- Argo CD owns K8s Application sync state only.
- First-party `campus-agent` workloads continue to use Kustomize/raw YAML by
  default.
- Third-party Kubernetes platform components may be consumed as pinned upstream
  Helm charts through Argo CD.
- Helm is used by Argo CD to render charts; Argo CD owns the application
  lifecycle.

The initial first-party Kustomize applications are:

- `execution-runtime-staging`
- `dining-sync-staging`

The initial third-party Helm applications are:

- `platform-keda`
- `platform-sealed-secrets` as the recommended default self-hosted/open-source
  secret delivery controller
- optional `platform-external-secrets` when the deployment selects External
  Secrets Operator as its secret delivery backend

ADR-0074 governs repository ownership: the application repository retains
reusable first-party Kustomize bases, while concrete Applications, overlays and
third-party Helm values live in the deployment environment repository.

## Consequences

- Argo CD does not manage Cloudflare resources. Terraform in the environment
  repository manages Worker traffic, Hyperdrive, Workers VPC, Turnstile and
  Access; Worker version upload remains in application CI and Worker secret
  values remain in Cloudflare.
- Argo CD does not manage app-api provider-config active profiles.
- First-party services are not charted until a later ADR accepts a concrete
  reason such as multi-tenant reuse, a large environment matrix or external
  installability.
- Third-party Helm chart versions and values files must be pinned in GitOps
  manifests to avoid automatic drift.
- Secret delivery backend selection is governed by ADR-0066. Argo CD can manage
  the selected backend's Kubernetes resources, but first-party workloads depend
  only on stable Kubernetes Secret names and keys.
- Argo CD / Kustomize owns tracked non-secret first-party deploy bootstrap
  ConfigMaps. Local env renderers may be used only for one-off manual bootstrap
  or migration diagnostics; they must not be documented as the GitOps staging or
  production path.

## Alternatives Considered

### No Helm anywhere

Rejected. It would force the repo to copy and maintain vendor manifests for
KEDA, optional secret delivery controllers and other mature platform
components.

### Helm chart every first-party service now

Rejected. The first-party execution runtime resource shape is still converging,
and Kustomize gives clearer diffs and reviewable Kubernetes resources.

### Let Argo CD manage Cloudflare Workers

Rejected. Workers are not Kubernetes resources. The environment repository
can own their desired state through Terraform without making Argo CD a
Cloudflare controller.
