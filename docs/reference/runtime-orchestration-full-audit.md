---
doc_type: reference
truth_scope: repository
owner_boundary: docs/reference
status: active
created: 2026-06-23
updated: 2026-06-23
---
<!-- markdownlint-disable MD013 -->

# Runtime Orchestration Full Audit

## Scope

This audit records the full-link orchestration posture for branch
`work/frontend-surface-doc-sync` on 2026-06-23.

It checks whether each committed runtime, package, infra surface, script lane
and guard belongs to the correct owner boundary in this worktree. It is an
evidence ledger, not live runtime truth. Architecture docs remain useful
topology constraints, but fast-moving deployment substrate claims are treated as
low-confidence unless backed by code, rendered manifests, tests or live
environment evidence. Project status remains `.planning/PROJECT.md` plus
`.planning/WORKSTREAMS.md`.

Decision standard:

- product/browser surfaces stay on Cloudflare Worker surfaces and enter shared
  `apps/app-api`
- execution runtime target is `apps/execution-control` + Temporal worker pools
  on K8s/KEDA/HPA
- ingestion/data plane stays outside the online execution K8s runtime until the
  ingestion-control and collector runtimes are re-reviewed
- delete confirmed dead local artifacts and scripts; mark uncertain modules
  `review_needed` instead of preserving speculative glue

## Repo-Evidence Flow Graphs

### Online Answer Path

```text
browser
-> campus-web Q&A
-> app-api assistant-ui / conversation / run routes
-> execution-control internal command
-> Temporal CapabilityExecutionWorkflow
-> context.memory_recall
-> agent.primary / agent-runtime
-> direct finalization or admitted typed tool / knowledge_query
-> Go RAG graph / structured read models / provider
-> finalization.write
-> sanitized run/event/step/attempt/result projection
-> app-api stream / operator read model
```

Repo-evidence posture: correct owner split. `campus-web` owns browser shell,
`app-api` owns product/auth/session/conversation/projection, `execution-control`
owns durable execution, Temporal owns execution substrate, and worker pools own
typed activity execution.

### Operator Path

```text
operator-console-web
-> explicit allowlist proxy
-> app-api operator routes
-> operator-safe request/runtime/provider projections
```

Repo-evidence posture: correct. Operator Console must not read PG, Temporal, K8s,
KEDA/HPA, Docker or telemetry sinks directly.

### Runtime Observability Path

```text
execution-control / worker / collector
-> app-api internal operator runtime ingest
-> operator.runtime projection tables
-> app-api operator query
-> operator-console-web
```

Repo-evidence posture: mostly correct. The `worker_autoscaler_*` naming is
historical, but committed contracts now include `worker_autoscaler_posture.v1`
for KEDA/HPA posture. Renaming tables now would add churn without changing
ownership.

### Ingestion / Data Path

```text
collector
-> app-api source/control-plane ingress when needed
-> ingestion-control task admission / registry / claim / lease / closeout
-> source truth / projection / document / index release
-> app-api or execution-control read-side consumption
```

Repo-evidence posture: intentionally not part of execution K8s runtime. The
`ingestion-control` and collector runtimes need separate review before any
deployment substrate decision.

### Local / Compose vs K8s Execution Runtime Shape

```text
Docker Compose local/transitional:
execution-control + Temporal + workers + worker-autoscaler

K8s target:
execution-control Service + Temporal + worker Deployments
+ KEDA Temporal ScaledObjects + HPA
+ temporal-task-queue-sampler
+ keda-hpa-posture-collector
```

Repo-evidence posture: corrected by this cleanup. `worker-autoscaler` is local /
Docker Compose transitional only in committed runtime docs and manifests; K8s
target uses KEDA/HPA and posture projection.

## Module Classification

| Module | Repo role | Upstream | Downstream | Target status | Action |
| --- | --- | --- | --- | --- | --- |
| `apps/campus-web` | Student browser surface, account shell, docs reader, Q&A shell | Browser | `apps/app-api` via allowlisted same-origin seam | keep_target_cloudflare | Keep out of K8s; guard via K8s forbidden workload list |
| `apps/operator-console-web` | Protected operator browser surface | Browser | `apps/app-api` operator APIs | keep_target_cloudflare | Keep out of K8s; no direct DB/Temporal/K8s reads |
| `apps/app-api` | Product/control-plane backend, auth/session/conversation/projection owner | Worker surfaces, collectors, execution-control projection producers | execution-control, PG projections, operator read models | keep_target_cloudflare | Keep out of K8s; do not split into panel backend |
| `apps/execution-control` | Internal execution ingress, Temporal command/query/cancel, Go activities, projection writer | `apps/app-api` | Temporal, workers, Qdrant, provider, app-api projection ingest | keep_target_k8s | Keep as only repo-owned K8s service owner |
| `apps/agent-runtime` | Model-facing OpenAI Agents SDK primary agent loop | `activity-worker-agent` | provider/tool-call envelope back to execution-control | keep_target_k8s_support | Keep in execution runtime K8s because primary agent activity depends on it |
| `workflow-worker` / `activity-worker-*` | Temporal worker pools | Temporal task queues | typed activities, projection writes | keep_target_k8s | Keep independent Deployments + KEDA ScaledObjects |
| `cmd/temporal-task-queue-sampler` | Operator-safe Temporal queue snapshot producer | Temporal | app-api internal runtime ingest | keep_target_k8s_support | Keep in K8s and Compose; no execution truth ownership |
| `cmd/keda-hpa-posture-collector` | Operator-safe KEDA/HPA posture producer | K8s API/KEDA/HPA read-only | app-api internal runtime ingest | keep_target_k8s_support | Keep; only service account allowed to read posture |
| `cmd/worker-autoscaler` | Docker Compose local/transitional scaler/evidence producer | app-api runtime projection, Docker Compose | Docker Compose worker replicas, app-api projection | keep_local_transitional | Do not deploy in K8s; delete when no Compose-based verification path uses it |
| `apps/ingestion-control` | Ingestion/data-plane task control plane | app-api source/control-plane ingress | source truth, projection, release tasks | review_needed | Do not add to execution K8s; re-review before separate deployment decision |
| `apps/ingestion-worker` | Python extraction adapter island | explicit TS handlers | normalized extraction artifacts | keep_adapter_island | Keep minimal; not a lifecycle executor or K8s runtime target |
| `apps/official-web-collector` | Source-channel collector runtime | official web | artifact pack/run ledger/app-api command ingress | review_needed | Keep out of execution K8s; collector deployment posture needs its own review |
| `apps/authenticated-notice-collector` | Authenticated notice collector/export runtime | authenticated portal | artifact/export envelope/app-api or ingestion handoff | review_needed | Keep out of execution K8s; no query-time tool exposure |
| `apps/wechat-official-account-collector` | WeChat source-channel collector runtime | WeChat source | app-api command ingress/source artifacts | review_needed | Keep out of execution K8s; not default product query runtime |
| `apps/legacy-office-conversion-service` | Legacy Office conversion local service | ingestion adapter island | normalized document output | keep_local_adapter | Keep as adapter/runtime support only; not execution K8s |
| `packages/contracts` | Shared execution/capability handoff schemas | app-api/execution-control/capability packages | typed consumers | keep_contract | Keep infra-neutral; no Qdrant/K8s/Temporal SDK leakage |
| `packages/shared` | Light shared constants/env/provider helpers | app/package consumers | app/package consumers | watch | Do not add business logic or provider transport code |
| `packages/ingestion-core` | Canonical ingestion/data-plane consumption logic | source artifacts/contracts | materialization/projection/release logic | keep_but_shrink_by_owner | Continue staged cleanup; do not bulk-delete |
| `packages/ingestion-contracts` | Task envelope/registry schemas | ingestion-control/configs | validators/tests | keep_contract | Keep; registry topology is not handler completion proof |
| `packages/ingestion-kernels-rs` | Deterministic file-level kernels | ingestion-control handlers | validated file artifacts | keep_kernel | Keep file-level only; no source-channel semantics |
| `packages/evals` / `packages/eval-langfuse` | Offline eval and trace/eval support | projections/golden datasets | eval artifacts | keep_offline | Keep out of serving path |
| capability packages | Domain semantic packages and typed capability support | execution-control/tool contracts | StepResult / projection contracts | keep_capability | Use only through admitted typed tools/activities |
| `infra/k8s/execution-runtime` | Execution-plane K8s baseline | deploy environment | execution-control, Temporal, workers, Hindsight, OTel, samplers | keep_target_k8s | Must exclude Cloudflare surfaces, ingestion runtimes and Compose autoscaler |
| `infra/local/docker-compose.execution-control-runtime*` | Local/transitional execution runtime | local/staging ops | execution-control, Temporal, workers, local autoscaler | keep_local_transitional | Keep only as local/transitional evidence; do not cite as staging truth without live proof |
| `infra/otel` | OTel collector config templates | runtime OTLP emitters | telemetry sinks | keep_ops_support | This is telemetry collector, not business ingestion collector |
| root `scripts/check_*` | Static guard lanes | repo files | repo:static | keep_guard | Keep only if referenced by package scripts/tests |
| `scripts/doctor_env_parse.py` | Old parser helper | none found | none | delete | Deleted: no current references |
| `scripts/reflow_markdown.py` | One-off markdown reflow helper | none found | none | delete | Deleted: no current references |

## `packages/shared` Audit

Current files:

| File | Current content | Judgment | Action |
| --- | --- | --- | --- |
| `packages/shared/src/campus_shared/constants.py` | `APP_NAME`, `/healthz`, `/readyz` | acceptable_tiny_constants | Keep |
| `packages/shared/src/campus_shared/env_bootstrap.py` | worktree-local `.env` loader and bootstrap state | acceptable_local_helper | Keep, but do not add surface-specific env policy here |
| `packages/shared/src/campus_shared/provider_config.py` | eval/local provider key precedence resolver | watch | Keep for local/eval diagnostics; do not turn into provider transport or app-api provider-config owner |
| `packages/shared/src/campus_shared/__init__.py` | lazy exports for constants/env/provider helpers | watch | Keep only while exports stay small |

Current consumers:

- `scripts/doctor_env.py` / `scripts/doctor_env_surface_specs.py`
- `packages/evals/src/campus_evals/*`
- `apps/ingestion-worker` env bootstrap
- tests for provider config, repo env bootstrap and shared boundary

Boundary verdict:

- No current domain semantics, regulation registry, answer-ready evidence
  contract, Qdrant runtime, SQL runtime, HTTP provider transport or app-api
  provider-config ownership was found inside `packages/shared`.
- Existing tests already guard the most important historical drift:
  `campus_shared` must not export regulation semantics.
- The only real watch item is `provider_config.py`: it is still a key
  precedence resolver for local/eval surfaces. It must not grow into a second
  provider-config control plane. The canonical product/runtime provider truth
  remains `apps/app-api` active profiles and execution-control request-scoped
  provider config.

Minimal next action:

- Do not split `packages/shared` now.
- Add new shared code here only if it is runtime-neutral, domain-neutral and
  has at least two real consumers.
- If `provider_config.py` needs app/runtime semantics, move that logic to the
  owning app instead of expanding shared.

## K8s Staging Worker-Pool Takeover Evidence

Committed repo evidence proves the intended K8s worker-pool shape exists. It
does not prove that a staging environment currently routes worker-pool traffic
through K8s. Takeover status is therefore `unverified_from_repo_alone`.

High-confidence repo evidence:

- `infra/k8s/execution-runtime/base/workers.yaml` defines one Deployment per
  worker pool.
- `infra/k8s/execution-runtime/base/keda-scaledobjects.yaml` defines one KEDA
  Temporal `ScaledObject` per worker pool.
- `infra/k8s/execution-runtime/base/samplers.yaml` defines
  `temporal-task-queue-sampler` and `keda-hpa-posture-collector`.
- `tests/infra/test_k8s_execution_runtime_manifests.py` verifies worker
  Deployments, ScaledObjects, RBAC, probes, PDBs, network policy and forbidden
  workload identities.

Stale-prone docs signals to reconcile:

1. Older active docs previously promoted Docker-first execution-control wording
   into current / frozen substrate truth. This batch corrected that wording; do
   not treat old deployment substrate claims as live runtime evidence.
2. `docs/architecture/system/kubernetes-execution-runtime-architecture.md`
   describes a staged migration. Step 5 is staging shadow validation or a
   dedicated K8s staging namespace; step 6 is cutting `app-api` staging
   `EXECUTION_CONTROL_BASE_URL` to the K8s execution-control Service / ingress.
   This is useful as a checklist, not proof that the checklist is incomplete in
   a live environment.
3. Staging runbooks still mention Docker Compose and K8s proof/target language.
   That is a docs drift signal, not runtime evidence.
4. No committed artifact in this repo captures applied K8s resources, app-api
   staging routing, fresh posture ingest or E2E scale evidence.

Correct takeover evidence:

- K8s worker Deployments are applied in staging.
- KEDA operator, metrics server, ScaledObjects and HPA are healthy.
- `temporal-task-queue-sampler` writes fresh
  `temporal_task_queue_metrics_snapshot.v1`.
- `keda-hpa-posture-collector` writes fresh
  `worker_autoscaler_posture.v1`.
- app-api staging points `EXECUTION_CONTROL_BASE_URL` at the K8s
  execution-control Service / protected ingress.
- E2E evidence shows backlog raises HPA desired replicas and idle
  stabilization scales down without failed in-flight activities.
- After that, Docker Compose `worker-autoscaler` is removed from staging/prod
  runbooks and remains local-only, or is deleted if local Compose is retired.

Do not infer "K8s has not taken over" from stale-prone docs alone. The only
safe repo-level conclusion is: the committed K8s target shape exists, while live
takeover remains unverified until the evidence above is captured.

## Redundancy And Drift Findings

| Finding | Evidence | Risk | Decision |
| --- | --- | --- | --- |
| K8s runtime could accidentally absorb non-execution workloads | execution K8s manifests live under `infra/k8s/execution-runtime`; product surfaces and ingestion runtimes are separate app owners | Wrong topology and duplicate deployment truth | Guard forbids `app-api`, `campus-web`, `operator-console-web`, collectors, ingestion runtimes and retired runtimes in execution K8s manifests |
| `worker-autoscaler` name looks production-shaped | Go command, Docker Compose service and app-api projection tables exist | Self-built scaler competes with KEDA/HPA | Keep only as local/transitional Compose proof; K8s manifests must use KEDA/HPA posture collector |
| `worker_autoscaler_*` schema names are historical | `worker_autoscaler_posture.v1` now covers KEDA/HPA posture | Premature rename would churn migrations and readers | Keep names for now; document committed semantics |
| Collector runtimes are real but not deployment-reviewed | source-channel collector apps exist and have runbooks | Pulling them into execution K8s would mix online execution and data plane | Mark `review_needed`; no K8s admission in this batch |
| `ingestion-control` exists but is not ready for K8s admission | data-plane docs say it owns task lifecycle, but user flagged current issues | K8s would harden an unreviewed design | Mark `review_needed`; keep out of execution runtime |
| ChatKit adapter retirement | repo guardrails and workspace tests forbid `apps/chatkit-adapter` | Old browser runtime could return through docs or app workspace | Existing guard is sufficient; no extra adapter cleanup needed |
| root script surface can grow into one-off tooling pile | two no-reference scripts existed | Dead scripts create false ownership | Delete no-reference scripts; keep referenced guard/smoke scripts |

## Cleanup Actions In This Batch

- Deleted no-reference scripts:
  - `scripts/doctor_env_parse.py`
  - `scripts/reflow_markdown.py`
- Removed local untracked Wrangler runtime artifacts:
  - `.wrangler-home/.wrangler`
  - `apps/app-api/.wrangler-home/.wrangler`
  - `apps/campus-web/.wrangler*`
  - `apps/operator-console-web/.wrangler*`
- Corrected runbook/contract wording so K8s closeout uses
  `worker_autoscaler_posture.v1` and Docker Compose autoscaler evidence stays
  transitional.
- Extended K8s manifest guard to reject product surfaces, collectors,
  ingestion runtimes, retired runtimes and `worker-autoscaler`.
- Corrected active docs that promoted superseded Docker-first execution-control
  wording into current / frozen substrate truth. Active docs now distinguish
  owner/topology truth from live substrate evidence.
- Deleted the stale non-ADR ADR governance audit snapshot because its
  2026-06-04 "no drift" verdict is obsolete and no longer current truth.
- Added residue guards so active docs cannot reintroduce Docker-first as the
  current execution-control substrate truth, while historical ADRs, archives and
  explicit low-confidence audit context remain allowed.
- Reworded the multi-turn context PRD to use capability handoff contract wording
  and avoid reviving retired deterministic-agent labeling.

## Remaining Work Queue

These are not blocked by this audit, but they are the next correct cleanup
order:

1. Re-review active docs that still mention deleted paths only as historical
   context. Path existence alone is not enough to delete those references; the
   owner question is whether each mention is a current obligation or historical
   explanation.
2. Re-review `apps/ingestion-control` before any deployment substrate decision.
   Output should be a small target-state doc or ADR update only if the owner
   boundary changes.
3. Re-review the three collector runtimes together. Decide which are source
   collectors, which are local tools, and which need deployable runtime shells.
4. Keep `packages/shared` small. Move any future domain logic or provider
   transport back to the owning app/package instead of expanding shared.
5. Retire Docker Compose `worker-autoscaler` only after live evidence proves the
   same worker pools are handled by KEDA/HPA and app-api receives fresh posture
   evidence, or after the Compose verification path is no longer needed.

## Verification Hooks

Committed guards that should catch architecture regression:

- `tests/infra/test_k8s_execution_runtime_manifests.py`
  - checks worker Deployments, ScaledObjects, KEDA posture collector, RBAC,
    network policy, PDBs and forbidden workload identities
- `tests/test_workspace_layout.py`
  - checks retired supervisor, legacy operator surfaces and ChatKit adapter stay
    absent
- `tests/infra/test_execution_control_architecture_residue.py`
  - checks active docs do not restore Docker-first execution-control substrate
    as current / frozen truth
- `pnpm repo:static`
  - checks docs frontmatter, docs inventory/reference graph, lint/static surface
    and deleted-script references
