---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0074
status: accepted
created: 2026-07-10
updated: 2026-07-14
---
# ADR-0074 Source And Environment Repository Boundary

## Context

The application repository is intended to become publishable and reusable by
other institutions. It previously mixed reusable Kubernetes workload bases
with the real staging Applications, Helm values, machine overlays, network
coordinates and encrypted secret inventory. Encryption protected secret values
but did not hide environment topology, resource names or operational ownership.
Keeping both copies also allowed source and deployed desired state to drift.

## Decision

Separate application source from deployed Kubernetes desired state.

The application repository owns:

- application, job and package source;
- stable runtime and secret-consumption contracts;
- namespace-neutral first-party Kustomize bases;
- image build, scan, SBOM and immutable SHA-tag publication;
- Cloudflare Worker build and immutable version upload without traffic changes;
- a promotion workflow that proposes environment changes through a pull
  request.

Each deployment environment repository owns:

- Argo CD root and child Applications;
- environment overlays, namespaces, resource sizing and network coordinates;
- pinned third-party Helm versions and values;
- strict-scope SealedSecrets and environment trust anchors;
- first-party image digests and full source commit SHA references;
- Cloudflare non-secret infrastructure, Worker version selection and traffic;
- Terraform remote state and environment-derived public GitHub variables;
- environment-specific rollout and cluster verification.

Environment repositories consume source bases only by full commit SHA and
first-party images only by registry digest. Application CI uses a dedicated
GitHub App to open an idempotent promotion pull request; it cannot push directly
to the environment repository's `main` branch. Argo CD reads both repositories
with a read-only GitHub App credential and reconciles an environment only after
the environment pull request is merged.

Cloudflare is not managed by Argo CD. The application repository uploads
immutable Worker versions, while the environment repository uses Terraform to
select those versions, manage traffic and reconcile Cloudflare infrastructure.
Worker secret values remain only in the Cloudflare Worker secret store and are
not copied into Terraform state or Kubernetes Secrets.

Existing private source history is not rewritten as part of this split. A
future public release must be produced from a separately reviewed, sanitized
snapshot and must pass history-level secret and topology review.

## Consequences

- The application repository no longer contains `infra/gitops`, real
  environment overlays, Helm deployment values or SealedSecrets.
- Generic Kustomize bases cannot create a Namespace, choose an environment
  ConfigMap, select mutable image tags or inject registry credentials.
- Deployment changes are reviewed where their blast radius is visible, and a
  merge to an environment repository is an explicit deployment action.
- One environment pull request can select both Kubernetes image digests and
  Cloudflare Worker versions produced by the same source commit.
- Source CI can prove source and generic base quality. Environment CI and Argo
  status prove deployability; neither may claim the other's result.
- Other institutions can fork the source repository and provide their own
  environment repository without editing upstream deployment topology.

## Alternatives Considered

### Keep all GitOps state in the application repository

Rejected. It exposes private topology, couples publication to environment
sanitization and creates mixed ownership between reusable source and one
operator's deployment.

### Generate manifests directly from CI without an environment repository

Rejected. It removes reviewable desired state and makes CI credentials the
deployment source of truth instead of Argo CD reconciliation.

### Let application CI write directly to environment `main`

Rejected. It bypasses review and turns a successful image build into an
unreviewed cluster change.
