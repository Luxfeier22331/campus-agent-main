---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-24
updated: 2026-07-11
---

# Execution Control Staging Operations

## Boundary

Execution-control staging operations are Kubernetes/GitOps-owned. Docker
Compose is local diagnostics only and must not own staging lifecycle.

Related owner docs:

- current topology: `../architecture/current.md`
- K8s runtime architecture: `../architecture/system/k8s-runtime.md`
- GitOps handoff: `gitops-k8s.md`
- product-path smoke: `execution-smoke.md`

The private environment repository owns Application names, namespaces, rollout
commands, recovery procedures and cluster evidence. This source runbook defines
the evidence contract and must not become a second environment runbook.

## Deploy And Status

The source deployment handoff is:

1. `.github/workflows/execution-runtime-publish.yml` publishes immutable runtime and Ops Web
   images, then opens an environment-repository pull request for the four images currently owned by
   the execution-runtime overlay. Ops Web is not promoted until its environment overlay exists.
2. Environment CI renders and validates its Applications, values, overlays and
   encrypted secret inventory.
3. Merging that pull request selects the deployment revision.
4. Argo CD reconciles the environment repository and records health at that
   revision.

The environment execution overlay runs a `PreSync` schema Job before
first-party Deployments reconcile. The Job uses the same immutable
`execution-control` image digest as the runtime, installs and verifies the run
projection schema and blocks sync on failure. Long-running processes keep
`EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE=false`.

Required deployment evidence:

- environment repository commit;
- root and child Application sync/health status;
- schema Job output with `passed=true`, `schema_ready=true` and
  `store=postgres`;
- first-party Deployment rollout status and immutable image digests;
- no runtime Pod in `CrashLoopBackOff`, `ImagePullBackOff` or unresolved
  `Pending` state.

Use the environment repository's runbook to collect that evidence. Do not add
cluster coordinates or direct sync commands here.

## Config And Secrets

Non-secret runtime config is tracked in the environment repository and
delivered as Kubernetes ConfigMaps. Secret material is delivered through the
environment-selected backend; this source repository records only stable
Secret consumption contracts. If the registry is private, the environment
overlay adds the matching pull Secret to first-party ServiceAccounts.

Provider active profiles remain app-api provider-config truth. Runtime
consumers use the reviewed provider projection artifact delivered through the
selected Secret/file delivery path. Missing Secrets, ConfigMaps or projections
are deployment blockers.

## Health And Triage

The environment runbook owns Pod events, logs, describes and dependency
Application inspection. Source-side release verification consumes only the
sanitized evidence above plus public app-api readiness:

```bash
curl --noproxy '*' -sS -i https://api-staging.mucwiki-edge.link/readyz
curl --noproxy '*' -sS -i https://campus-staging.mucwiki-edge.link/readyz
```

If execution-control readiness is degraded, identify whether Temporal,
Hindsight, Qdrant, OTel, Postgres or the first-party runtime Application owns
the failed dependency. Fix desired state in the environment repository; do not
recreate Docker staging scripts, local env renderers or direct host mutation as
a workaround.
