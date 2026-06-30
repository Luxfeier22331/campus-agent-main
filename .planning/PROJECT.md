# Campus Agent Project Work Map

## Purpose

`campus-agent` is the v2 campus assistant monorepo. It serves student, staff,
operator, and prospective-student workflows through product surfaces backed by a
shared `app-api` and an internal Temporal execution plane.

The accepted execution topology is:

```text
Product/browser surfaces
-> app-api
-> execution-control
-> Temporal
-> tool activity workers
-> OpenAI Agents SDK primary agent loop / Go RAG DTO/runtime / typed tools
-> Qdrant / provider / structured data-plane services
```

`app-api` owns product API, auth/session, conversation/request projection, and
browser-facing read models. `execution-control` owns internal execution
admission, Temporal command/query/cancel, policy closeout, readiness, metrics,
and sanitized projection writes. Temporal is the execution truth. PG stores
product data and sanitized run/event/step projection, not the execution queue.

## Active Work Map Facts

- Product entry surface is `campus-web` at `https://campus.muc.wiki`; staging
  browser validation uses `https://campus-staging.mucwiki-edge.link`.
  `campus-web` and `operator-console-web` enter shared `app-api`. Docs are now
  a `campus-web /docs/*` Rspress-powered reader surface, not a separate forward
  docs product surface.
- `campus-web` owns the student-facing campus experience and account browser
  shell. `apps/app-api` remains the only auth/session/identity/federation truth
  owner.
- Default query-enabled surfaces are `regulations/student_rules`,
  `regulations/institutional_rules`, `curriculum/curriculum_plan`, and
  `official_web/stable_reference`.
- The main answer path now enters the OpenAI Agents SDK primary agent loop after
  memory recall: direct/no-tool turns use `context.memory_recall ->
  agent.primary -> finalization.write`; knowledge turns use
  `context.memory_recall -> agent.primary -> knowledge_query workflow signal ->
  Go RAG graph -> finalization.write`. Go/Temporal keep durable workflow,
  admission, timeout/cancel, RAG graph execution and sanitized projection
  ownership.
- Ordinary chat routing is primary-agent-first: missing `requested_tool`
  remains an absent caller hint through `execution-control`, exposes the admitted
  visible tool set to `agent.primary`, and uses neutral `any` memory recall
  instead of defaulting to `knowledge_query`.
- Model-selected campus-services / notice read-only tools are callable through
  the agent-runtime execution-control internal query executor only when the
  tool is model-visible in `tools.v4` and opened by the execution-control
  runtime profile; their success or fail-close results project as normalized
  `sdk_tool.execute.<tool>.<index>` steps instead of living only in SDK trace or
  finalization payload.
- RAG remains available as a Go-owned seven-step Temporal activity support path:
  `planning -> rag.plan -> retrieval.indexed_lookup ->
  retrieval.expand_or_rescue -> evidence.selection -> synthesis ->
  grounding.verify -> finalization.write`.
- Python `apps/supervisor-agent-worker` has been removed from the active
  workspace. Historical handoff code is recoverable only through git history.
  Current online concepts are execution runtime, primary agent actor, and
  concrete tools; `supervisor` is a retired implementation name, not an abstract
  role to preserve.
- Qdrant remains self-hosted authenticated private data-plane infrastructure.
  API keys are data-plane secrets; transport hardening is an ops issue, not a
  reason to remove authentication.
- Historical planning archives are no longer tracked at branch tip. Recover
  prior phase narratives through git history when needed.

## Current Repo State

- There is no tracked active workstream directory in this repository.
- `.planning/WORKSTREAMS.md` is a compact active work map, not a phase ledger.
- The repo-level implementation gap ledger lives in
  `.planning/WORKSTREAMS.md#implementation-gap-ledger`; do not duplicate that
  table in current/target architecture docs.
- Workstream/session state is handled by GSD SDK and Codex native sessions. Do
  not recreate tracked phase trees, terminal-result artifacts, heartbeat files,
  hook state, or repo-owned harness state.
- Structural planning that should persist must be promoted into durable docs,
  ADRs, runbooks, contracts, schemas, or a short update to this file.
- Durable governance principles belong in the owning docs/ADR/contract/runbook;
  this work map may point to them but must not redefine them.

## Owner Areas

| Area | Owner Boundary | Primary SoT |
| --- | --- | --- |
| Product Plane | `campus-web`, browser surfaces, product API, auth/session, request projection | `docs/architecture/system/product-runtime.md` |
| Execution Plane | `execution-control`, Temporal, projection store, worker topology | `docs/architecture/system/durable-runtime.md` |
| Tool Plane | RAG, navigation, notice, campus services, semantic worker | `docs/architecture/system/tool-runtime.md` |
| Data Plane | Ingestion, object storage, Qdrant, source truth, read models | `docs/architecture/system/data-plane.md` |
| Ops / QA | staging, release gates, observability, smoke evidence | `docs/runbooks/e2e-qa-release.md` |

This file is a `planning_work_map`. It can point to current facts and work
signals, but it does not override architecture, contract, data, ADR or runbook
truth. Conflict resolution follows `docs/documentation-architecture.md`.

## Backlog Triggers

Create or resume durable docs/ADRs/runbook work when any of these occur:

- A product surface, source family, or tool is admitted into default
  serving scope.
- Temporal workflow/activity topology, worker autoscaling, or projection schema
  changes.
- Primary agent SDK loop, direct/no-tool terminal projection, visible tool
  catalog, or tool routing contract changes.
- A data-plane source truth, ingestion release, query-enabled surface, or access
  boundary changes.
- Staging/release evidence reveals drift between `app-api`, execution-control,
  Temporal, workers, PG projection, or observability.
- A historical planning artifact contains a decision still needed today; recover
  only the decision into active docs, not the whole archive tree.

## Out Of Scope For Planning

- Reintroducing `.planning/workstreams`, `.planning/quick`,
  `.planning/legacy-flat`, `.planning/milestones`, `.planning/research`,
  `.planning/todos`, `.planning/codebase`, or `.planning/seeds` as tracked
  directories.
- Treating git history snapshots as active project truth.
- Adding fallback paths, compatibility routes, old env aliases, PG lease runtime,
  or legacy answer endpoints to make old tests pass.
