---
doc_type: reference
truth_scope: ops
owner_boundary: infra/gitops
status: active
created: 2026-07-04
updated: 2026-07-06
---
# GitOps Secret Delivery

This directory is the target placeholder for Kubernetes secret-delivery
manifests consumed by Argo CD after a deployment selects a concrete delivery
path.

Allowed tracked manifests:

- `ExternalSecret`, `SecretStore` or `ClusterSecretStore`
- Bitnami `SealedSecret`
- SOPS-encrypted Kubernetes `Secret`
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
The selected deployment secret-delivery path owns how those Secret objects are
populated. The retired monolithic `execution-runtime-secrets`,
`execution-runtime-common-secrets`, `execution-worker-common-secrets`,
`notice-tool-secrets` and
`qdrant-admin-secrets` Secrets must not be recreated as execution-runtime
inventory. Notice body object-store credentials and Qdrant admin lifecycle keys
belong to their owning notice/data-plane jobs when those paths are admitted,
not to the default online execution runtime.

Third-party platform Applications consume their own stable Secret names:

- Qdrant server: `qdrant-server-secrets` and `qdrant-server-tls`
- Temporal server: `temporal-db-secret`
- Hindsight API: `hindsight-api-secrets`
- OTel collector: `otel-collector-secrets`
- CNPG database owners:
  `campus-agent-postgres-campus-agent-owner`,
  `campus-agent-postgres-temporal-owner` and
  `campus-agent-postgres-hindsight-owner`

These platform Secrets are not emitted by the execution-runtime renderer.
Online RAG clients still consume only
`execution-rag-secrets/QDRANT_QUERY_API_KEY`; they must not carry Qdrant server
admin keys.
Provider active profiles remain owned by app-api provider-config and are
consumed through explicit runtime projections, not through this directory.

`dining-sync-secrets` is consumed by the dining sync CronJob and must contain:

- `DATABASE_URL`
- `DINING_LARK_APP_ID`
- `DINING_LARK_APP_SECRET`
- `DINING_MODERATION_API_KEY`
- `OBJECT_STORE_ACCESS_KEY`
- `OBJECT_STORE_SECRET_KEY`

Dining table ids, object-store bucket names, public asset URLs and moderation
model names are non-secret config and stay in the dining-sync ConfigMap or
environment-specific overlays.

## Delivery Options

The stable contract is Kubernetes Secret name and key shape, not the backend.
Deployments may choose one of these paths:

- Manual Kubernetes Secrets: lowest moving-parts option for small self-hosted
  installs. Operators create role-scoped Secrets with `kubectl`; rotation and
  audit stay in the operator runbook.
- Sealed Secrets: recommended default for repo-supported self-hosted/open-source
  GitOps. Encrypted `SealedSecret` resources are safe to commit and are
  decrypted only by the target-cluster controller into Kubernetes Secrets. This
  adds one controller plus the `kubeseal` client and requires sealing-key
  backup/rotation discipline.
- External Secrets Operator: syncs keys from an external secret manager into
  Kubernetes Secrets. Use this when the deployment already has AWS Secrets
  Manager, Vault, 1Password, Google Secret Manager, Azure Key Vault or similar.
- SOPS-encrypted Secrets: encrypted Secret manifests can live in git, but Argo
  CD needs a reviewed decrypt integration and key-management process.

`staging-secret-delivery.externalsecrets.example.yaml` shows the expected shape
of `ClusterSecretStore` and role-scoped `ExternalSecret` resources for
deployments that choose ESO. It intentionally uses an invalid placeholder
backend URL and remote references only; real backend credentials, provider API
keys and Worker secrets must stay outside plaintext git. The file covers
runtime, platform/data, memory and observability owners; it is not
execution-runtime inventory.

## Sealed Secrets Workflow

Use `infra/gitops/apps/platform-sealed-secrets.yaml` to install the Bitnami
Sealed Secrets controller through Argo CD. The repo values set
`fullnameOverride: sealed-secrets-controller` in `kube-system` so the
`kubeseal` CLI can use its default controller identity.

Workflow:

1. Create a local, untracked Kubernetes `Secret` manifest from the deploy-side
   secret store or operator-owned runbook.
2. Seal it for the exact target namespace and Secret name:
   `kubeseal --format yaml < secret.local.yaml > infra/gitops/secrets/<name>.sealedsecret.yaml`.
3. Review that the output is `kind: SealedSecret`, contains only
   `spec.encryptedData`, and does not contain plaintext `stringData`, token,
   password, DSN or private key values.
4. Commit only the `SealedSecret` resource.
5. Back up the controller sealing key and document the restore point in the
   deployment runbook.

SealedSecret resources must use the default strict scope. Do not commit
`sealedsecrets.bitnami.com/namespace-wide: "true"`,
`sealedsecrets.bitnami.com/cluster-wide: "true"` or the equivalent
`sealedsecrets.bitnami.com/scope` values unless a separate ADR/runbook accepts
that wider blast radius.

Kubernetes ConfigMap/Secret separation policy is checked by `pnpm repo:static`.
It is an explicit infrastructure policy lane until the repo standardizes
Conftest installation in CI images.
