---
doc_type: reference
truth_scope: ops
owner_boundary: infra/gitops
status: active
created: 2026-07-04
updated: 2026-07-04
---
# GitOps Secret Delivery

This directory is the target placeholder for Kubernetes secret-delivery
manifests consumed by Argo CD after a concrete external secret backend is
selected.

Allowed tracked manifests:

- `ExternalSecret`
- `SecretStore`
- `ClusterSecretStore`
- namespace, service account or RBAC resources required only for secret sync

Forbidden tracked content:

- real API keys, passwords, tokens, DSNs or private keys
- local env file references
- LLM/search/embedding/rerank provider active-profile decisions
- Cloudflare Worker secret material

Workloads continue to consume Kubernetes Secrets by stable names such as
`execution-runtime-secrets` and `dining-sync-secrets`. External Secrets
Operator owns how those Secret objects are populated. Provider active profiles
remain owned by app-api provider-config and are consumed through explicit
runtime projections, not through this directory.
