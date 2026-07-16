---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0066
status: accepted
created: 2026-07-03
updated: 2026-07-16
---
# ADR-0066 Secret Delivery

## Context

The repository previously carried K8s `secret.example.yaml` files alongside
Worker `secrets.required` declarations. Plaintext Kubernetes Secret examples
were useful during bootstrap, but they were too easy to mistake for
staging/production inventory and did not define real secret delivery without
copying local files or committing credentials.

## Decision

Use stable Kubernetes Secret names as the workload contract. The concrete
secret delivery backend is deploy-time infrastructure, not workload
architecture truth.

- Secret objects are grouped by credential owner, lifecycle and mutation
  boundary rather than duplicated for each Pod.
- Workloads consume only the required keys through explicit projections. A
  shared Secret object does not replace separate provider-side identities or
  permissions.
- Real secret material stays outside plaintext git.
- Deployment environment repositories may contain delivery-backend references
  or encrypted secret resources, but not plaintext secret values. The
  application source repository contains only stable Secret consumption names
  and placeholder examples.
- Sealed Secrets is the recommended default for repo-supported self-hosted and
  open-source deployments because it keeps GitOps reviewability without
  requiring a separate hosted secret manager.
- Supported delivery choices remain manual Kubernetes Secret creation, Sealed
  Secrets, External Secrets Operator and SOPS-backed encrypted Secret
  manifests. Switching backend must not change first-party Deployment/CronJob
  consumption contracts.
- A short-lived runtime credential that requires frequent human rotation may
  use a fixed, pre-created Secret whose data is updated by an explicitly
  allowlisted in-cluster operation. That exception requires resource-name RBAC,
  must not grant Secret creation or enumeration, and does not make Git a
  credential history.

Cloudflare Worker secrets remain in the Cloudflare Worker secret store and are
audited through Worker deploy/preflight tooling. Worker secrets are not mirrored
through K8s.

Kubernetes secret delivery does not own Cloudflare Worker secrets, Docker local
secrets or app-api provider-config active profiles.

## Consequences

- K8s `secret.example.yaml` inventory files are retired from execution-runtime
  manifests. Secret contracts live in workload references and the GitOps secret
  delivery documentation instead.
- Manual K8s Secret creation is accepted for small self-hosted deployments when
  the operator also owns rotation and audit runbooks.
- The internal-portal `SSO_TGC` uses one empty environment-initialized Secret;
  Ops Web may read and patch only that Secret. Long-lived API keys, DSNs and
  trust anchors continue to use the environment's normal delivery backend.
- The TGC cannot share a Secret object with other credentials because
  Kubernetes Secret RBAC is resource-scoped, not key-scoped.
- A deployment environment repository may provide a pinned
  `platform-sealed-secrets` Argo CD Application for the recommended default
  self-hosted GitOps path.
- SealedSecret manifests committed to an environment repository must use the
  default strict scope. Namespace-wide or cluster-wide sealing is a separate
  risk acceptance, not a default.
- Secret delivery checks must reject provider API keys, DSNs, tokens or shared
  secrets in GitOps manifests and Helm values.
- A deployment can switch from manual Secrets to Sealed Secrets, External
  Secrets Operator or SOPS without changing workload consumption contracts.
- Repo policy checks may verify Secret/ConfigMap separation, retired Secret
  names and forbidden key placement, but real secret material remains outside
  git.
- Local `.env` files may be an operator input when creating a reviewed Secret,
  SealedSecret, ExternalSecret backing value or SOPS-encrypted Secret. They are
  not themselves Kubernetes desired state and must not be applied directly in
  GitOps runbooks.

## Alternatives Considered

### Mandate External Secrets Operator

Rejected as a universal requirement. External Secrets Operator is appropriate
when a deployment already has an external secret manager, but it adds a
controller and backend dependency that small self-hosted installations may not
need.

### Mandate Sealed Secrets As The Only Backend

Rejected as a universal requirement. Sealed Secrets is lighter than a full
external secret manager, but it still adds a controller and cluster sealing-key
lifecycle. It is the recommended default for this repo's self-hosted GitOps
path, not the only acceptable substrate.

### Keep copying `.env` files to staging hosts

Rejected as the repo contract. Operators may use local env only as input to a
reviewed secret creation step; workloads must consume Kubernetes Secrets, not
raw copied env files.

### Use app-api provider-config as a general secret manager

Rejected. Provider-config governs model/search provider profiles; it is not a
generic deploy secret store.
