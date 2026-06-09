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
- Step projection should remain the panel/eval/operator diagnostic spine and
  must carry cancel/timeout/token/cost evidence for failure-mode runs.
- Worker autoscaler remains an operations-plane proof: read Temporal/task queue
  metrics and downstream budgets, output desired replicas, never write
  workflow/run/event/terminal state.
- Notice, navigation, and campus-services capabilities should continue as typed
  activity/tool contracts, not entry-level agents.
- Remote deploy worktrees must remain clean pinned deploy checkouts; secrets and
  runtime env belong to ops/Docker-managed config, not repo checkout state.
