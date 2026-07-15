# Campus Agent Project

## Purpose

`campus-agent` is the v2 campus assistant monorepo. This file is the compact
project-level planning entry. It routes work to the document or code owner that
holds the durable truth; it does not restate runtime topology, tool exposure,
serving targets or completed migration history.

## Canonical Truth

- Product boundary: `docs/architecture/product.md`
- Current merged architecture: `docs/architecture/current.md`
- Target invariants: `docs/architecture/target.md`
- Cross-owner flows: `docs/architecture/flows.md`
- Documentation ownership: `docs/documentation-architecture.md`
- Active and deferred work signals: `.planning/WORKSTREAMS.md`

Feature worktree progress becomes current truth only after its pull request
lands on `main`. Release state is selected by release tags and GitHub
Environments, not by this planning file.

## Owner Areas

| Area | Owner boundary | Durable entry |
| --- | --- | --- |
| Product | `campus-web`, browser surfaces, `app-api`, auth/session and product projections | `docs/architecture/system/product-runtime.md` |
| Execution | `execution-control`, Temporal, Agent SDK runtime and run/step projections | `docs/architecture/system/durable-runtime.md` |
| Tools | Model-visible tools, Knowledge Agent retrieval and domain read models | `docs/architecture/system/tool-runtime.md` |
| Data | Source collection, ingestion, publication, object storage and query-serving data | `docs/architecture/system/data-plane.md` |
| Eval and observability | Langfuse traces/datasets/scores, Ragas and learning-loop intake | `docs/architecture/system/langfuse.md` |
| Operations and release | CI lanes, deployment, smoke, readiness and release procedures | `docs/reference/testing-and-verification-lanes.md` |

## Planning Rules

- Put current topology in `docs/architecture/current.md`, not here.
- Put long-term constraints in `docs/architecture/target.md` or an ADR.
- Put HTTP, runtime and schema behavior in contracts and data documents.
- Put repeatable operational steps in runbooks.
- Put only active or deliberately deferred work signals in
  `.planning/WORKSTREAMS.md`.
- Recover historical phase or workstream context through git history and
  promote only the still-relevant fact into its current owner document.
- Do not recreate tracked phase trees, quick-task directories, terminal-result
  artifacts, leases, heartbeats or hook-managed planning state.

## Reopen Triggers

Update the owning durable document before adding a planning signal when:

- a product surface, source family, query-serving target or model-visible tool
  is proposed;
- Temporal workflow/activity topology or projection contracts change;
- an ingestion source, materialization path or release owner changes;
- an eval observation source, scorer, dataset contract or platform boundary
  changes;
- a release procedure exposes a repeatable mismatch between documented and
  executable behavior.
