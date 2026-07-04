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

Workloads consume Kubernetes Secrets by stable, role-scoped names such as
`execution-control-secrets`, `execution-worker-common-secrets`,
`execution-agent-client-secrets`, `agent-runtime-secrets`,
`execution-memory-client-secrets`, `execution-rag-secrets`,
`execution-control-internal-query-secrets`, and `dining-sync-secrets`.
External Secrets Operator owns how those Secret objects are populated. The
retired monolithic `execution-runtime-secrets` Secret must not be recreated.
Provider active profiles remain owned by app-api provider-config and are
consumed through explicit runtime projections, not through this directory.
