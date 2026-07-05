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
`execution-control-secrets`, `execution-control-metrics-secrets`,
`execution-telemetry-client-secrets`, `execution-run-projection-secrets`,
`execution-temporal-workflow-secrets`,
`execution-agent-client-secrets`, `agent-runtime-secrets`,
`execution-memory-client-secrets`, `execution-rag-secrets`,
`execution-tool-read-model-secrets`, `execution-control-internal-query-secrets`,
and `dining-sync-secrets`.
External Secrets Operator owns how those Secret objects are populated. The
retired monolithic `execution-runtime-secrets`,
`execution-runtime-common-secrets`, `execution-worker-common-secrets`,
`notice-tool-secrets` and
`qdrant-admin-secrets` Secrets must not be recreated as execution-runtime
inventory. Notice body object-store credentials and Qdrant admin lifecycle keys
belong to their owning notice/data-plane jobs when those paths are admitted,
not to the default online execution runtime.
Provider active profiles remain owned by app-api provider-config and are
consumed through explicit runtime projections, not through this directory.

The staging example manifest shows the expected shape of `ClusterSecretStore`
and role-scoped `ExternalSecret` resources. It intentionally uses an invalid
placeholder backend URL and remote references only; real backend credentials,
provider API keys and Worker secrets must stay outside git.

Kubernetes ConfigMap/Secret separation policy is checked by
`uv run --all-packages python -m scripts.check_k8s_config_secret_policy` when
Conftest is installed. It is an explicit infrastructure policy lane until the
repo standardizes Conftest installation in CI images.
