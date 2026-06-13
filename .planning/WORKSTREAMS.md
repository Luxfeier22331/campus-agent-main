# Active Work Map

## Status

There are no tracked active workstream directories in this repo.

This file is the compact repo-level work map. It is not a completed-workstream
ledger, phase archive, evidence tree, or session handoff store. Historical
workstream and phase material is available through git history.

## Working Model

- Use GSD SDK and Codex native sessions for live workstream/session state.
- Persist durable outcomes in the correct long-lived artifact:
  - architecture truth -> `docs/architecture/`
  - decisions -> `docs/decisions/`
  - contracts -> `docs/contracts/`
  - schemas/data truth -> `docs/data/`
  - operations -> `docs/runbooks/`
  - project-level map -> `.planning/PROJECT.md` and this file
- Do not recreate tracked `.planning/workstreams`, `.planning/quick`,
  `.planning/legacy-flat`, `.planning/milestones`, `.planning/research`,
  `.planning/todos`, `.planning/codebase`, or `.planning/seeds`.

## Owner Areas

| Area | Scope | Reopen Trigger |
| --- | --- | --- |
| Product Plane | `hub-web`, `public-chat-web`, `public-docs`, `protected-panel-web`, shared `app-api` | Product surface, auth/session, request projection, or browser contract changes |
| Execution Plane | `execution-control`, Temporal workflows, run/step projection, readiness | Workflow topology, projection schema, execution ingress, cancel semantics, or worker readiness changes |
| Capability Plane | RAG, navigation, notice, campus services, semantic worker | New typed tool/activity, agent-as-tool boundary, routing/admission, or capability evidence changes |
| Data Plane | ingestion, object storage, Qdrant, source truth, read models | Source family admission, ingestion release, query-enabled surface, ACL, or data-plane transport changes |
| Ops / QA | staging, release gates, observability, deploy hygiene | Staging closeout, release smoke, ingress, secrets, evidence, or monitoring changes |

## Recovery Rule

If a deleted planning archive contains useful context, recover only the specific
decision, requirement, or evidence reference into an active doc/ADR/runbook with
current terminology. Do not restore the archive directory or treat old phase
status as current project truth.

## Current Backlog Signals

- Temporal execution-control normal-path staging closeout has real `nc-arm-6c`
  evidence; remaining closeout work is failure-mode proof for cancel, timeout,
  late completion, and panel/eval/operator consumption.
- Main answer path first-decision work has moved into the primary agent SDK loop:
  direct/no-tool turns finalize from `agent.primary`; knowledge turns use
  `knowledge_query` to enter the Go RAG graph. Ordinary chat with missing
  `requested_capability` now stays capability-neutral and lets `agent.primary`
  choose within the admitted visible tool set. Model-selected campus-services /
  notice read-only tools now project success / fail-close results as normalized
  `sdk_tool.execute.<tool>.<index>` tool steps. Clarification and out-of-scope
  terminal outcomes now project as typed `needs_clarification` / `rejected`
  finalization responses. Strict SDK tool argument schema is hardened by the
  canonical `tool_function_schemas.v1` fixture and execution-control validation;
  remaining work is real runtime/staging proof, not basic panel/eval trajectory
  consumption.
- Step projection should remain the panel/eval/operator diagnostic spine and
  now carries cancel/timeout/late-completion/token/cost/fail-close/replan
  evidence for local failure-mode projection tests.
- Eval / badcase / future release evidence should converge on the app-api-owned
  `operator_step_trajectory.v1` export. The app-api request observability detail
  now materializes that export from sanitized execution-control step projection.
  Panel formatter diagnostics, eval/badcase stage attribution, and
  release-evidence-shaped local fixtures consume that export. Replan and
  terminal outcome stages (`clarification`, `rejected`, `no_answer`) now enter
  the same badcase denominator through explicit trajectory attribution; real
  staging closeout and Temporal metrics sampling remain deferred until the
  runtime path is mature.
- Worker autoscaler remains an operations-plane proof: read Temporal/task queue
  metrics and downstream budgets, output desired replicas, never write
  workflow/run/event/terminal state. It now has explicit `dry-run` and `apply`
  modes; `apply` fails closed without an explicit actuation evidence path and
  writes only ops-plane actuation evidence, not execution truth.
- Notice, navigation, and campus-services capabilities should continue as typed
  activity/tool contracts, not entry-level agents.
- Campus services P1 now has an app-api operator-maintained source channel base:
  manual attestations, bounded service-status / transport overrides, preview,
  publish release snapshot, audit events, and execution-control consumption of
  published current-effective release snapshots. Remaining gap is staging/runtime
  proof and opening evidence; do not treat notice candidate review or
  release-task evidence as mature enough for this lane.
- Bounded semantic retry / replan is now implemented as an explicit typed
  outcome allow-list: `provider_timeout`, `tool_handler_failed`,
  `provider_connection_aborted`, `tool_executor_not_configured`, and
  `transient_internal_query_failed` can replan once inside the same visible
  capability/tool set; deterministic semantic/policy/contract/admission failures
  and unclassified failures fail closed.
- Remote deploy worktrees must remain clean pinned deploy checkouts; secrets and
  runtime env belong to ops/Docker-managed config, not repo checkout state.
