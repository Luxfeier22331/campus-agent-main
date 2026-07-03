---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0066
status: accepted
created: 2026-07-03
updated: 2026-07-04
---
# ADR-0066 Secret Delivery

## Context

The repository currently has K8s `secret.example.yaml` files and Worker
`secrets.required` declarations. These are useful contracts, but they do not
define how real staging/production secret material is delivered without
copying local files or committing credentials.

## Decision

Use External Secrets Operator as the target Kubernetes secret delivery layer.

- External secret stores own secret material.
- External Secrets Operator syncs selected keys into Kubernetes Secrets.
- Workloads consume Kubernetes Secrets by name.
- Repo-tracked manifests may contain `ExternalSecret`, `SecretStore` or
  `ClusterSecretStore` references, but not secret values.

Cloudflare Worker secrets remain in the Cloudflare Worker secret store and are
audited through Worker deploy/preflight tooling. Worker secrets are not mirrored
through K8s.

## Consequences

- K8s `secret.example.yaml` files remain examples and bootstrap aids, not
  staging or production secret truth.
- Manual K8s Secret creation is allowed only as transitional bootstrap for a
  non-GitOps staging environment.
- Secret delivery checks must reject provider API keys, DSNs, tokens or shared
  secrets in GitOps manifests and Helm values.
- The concrete external secret backend can be selected later without changing
  workload consumption contracts.

## Alternatives Considered

### Commit encrypted Secret manifests

Rejected for now. SOPS or Sealed Secrets can work, but they would still make the
repo the primary secret artifact store. The target shape is external secret
store ownership with Kubernetes sync.

### Keep copying `.env` files to staging hosts

Rejected. It is not auditable enough and caused repeated local/staging drift.

### Use app-api provider-config as a general secret manager

Rejected. Provider-config governs model/search provider profiles; it is not a
generic deploy secret store.
