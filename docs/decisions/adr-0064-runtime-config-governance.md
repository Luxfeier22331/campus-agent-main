---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0064
status: accepted
created: 2026-07-03
updated: 2026-07-04
---
# ADR-0064 Runtime Config Governance

## Context

`campus-agent` now spans Cloudflare Workers, self-hosted execution runtime,
Temporal, K8s target manifests, provider-config profiles and eval/runtime
projection artifacts. Treating every value as an environment variable has
already caused drift between local worktrees, staging runtime, Worker deploy
secrets and app-level provider governance.

The repository needs one config taxonomy that makes ownership explicit and
prevents deployment tools from becoming business configuration truth.

## Decision

Adopt five runtime config classes:

1. `repo_static_config`: tracked source files such as tool schemas, Kustomize
   overlays, Wrangler config and policy JSON.
2. `deploy_bootstrap_config`: non-secret runtime handles such as service URLs,
   namespace names, runtime config paths and feature posture required to start
   a deployed process.
3. `secret_material`: credentials, tokens, DSNs and shared secrets delivered by
   the owning deploy secret store.
4. `app_operational_config`: business/operator state mutated through an owning
   app control plane, including LLM/embedding/rerank provider profiles.
5. `generated_runtime_projection`: sanitized artifacts exported from an owner
   service for runtime consumers, including provider-config snapshots.

`apps/app-api` provider-config remains the source of truth for external model,
embedding and rerank provider active profiles. K8s
ConfigMap/Secret, Helm values, Wrangler vars/secrets and local `.env` files
must not become provider active-profile truth.

This ADR does not introduce a repo-owned configuration platform. Mature
delivery mechanisms keep their native ownership:

- Kubernetes ConfigMaps carry non-secret deploy bootstrap config.
- Kubernetes Secrets carry delivered secret material.
- External Secrets Operator syncs external secret-store values into Kubernetes
  Secrets.
- Cloudflare Worker vars/secrets remain in Wrangler / Cloudflare Worker deploy
  workflows.
- Docker Compose env and secrets remain local-runtime bootstrap surfaces.
- app-api provider-config owns app-operational provider profile truth.

Repo-tracked policy files and static checks only express cross-substrate
contracts and fail-closed drift detection. They must not replace Kubernetes,
Wrangler, Docker Compose, External Secrets Operator or app-api provider-config.

## Consequences

- Local seed env may initialize provider-config, but serving runtimes consume
  explicit provider-config projections where needed.
- Local provider seed input lives in a command-scoped template, not root
  `.env.example`. Root `.env.example` is limited to shared local Postgres
  handles.
- K8s ConfigMap/Secret and Cloudflare Worker vars/secrets may carry bootstrap
  handles and secret material, not app-level provider decisions.
- K8s GitOps staging/production paths must not generate ConfigMaps or Secrets
  directly from copied `.env` files. Any env renderer that emits
  `kubectl create configmap/secret --dry-run` output is a manual bootstrap or
  transitional debug helper, not desired-state truth.
- GitOps and deployment tools reconcile desired runtime resources; they do not
  mutate provider-config profiles.
- Readiness and static checks must fail closed when a runtime claims staging or
  production truth from local-only `.env` / `.dev.vars` surfaces.

## Alternatives Considered

### Put all config in K8s and Helm

Rejected. It would make deployment templates own business provider truth and
would bypass Operator Console / app-api audit, validation and activation.

### Keep per-runtime env files as the main contract

Rejected. It preserves the drift that caused repeated staging mismatch and
provider confusion.

### Build a repo-owned env registry/config platform

Rejected. The repo needs cross-surface policy and static checks, not a new
runtime configuration system. Native platform components remain the delivery
and secret owners.

### Move provider profiles into Cloudflare Worker secrets

Rejected. Worker secrets are a deploy secret store, not an operator-governed
profile registry or validation surface.
