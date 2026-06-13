---
doc_type: index
truth_scope: repository
owner_boundary: docs
status: active
created: 2026-03-22
updated: 2026-06-13
---

# Docs

`docs/` is the long-lived documentation surface for `campus-agent`.

The repository uses a Source-of-Truth documentation architecture. Read
`documentation-architecture.md` first when a question depends on which document
class owns a fact.

## Question Routing

- Product boundary, users and non-promises:
  - [architecture/product-positioning.md](./architecture/product-positioning.md)
- Current accepted merged truth:
  - [architecture/current-architecture.md](./architecture/current-architecture.md)
- Long-term architecture invariants:
  - [architecture/target-architecture.md](./architecture/target-architecture.md)
- Documentation truth classes and conflict resolution:
  - [documentation-architecture.md](./documentation-architecture.md)
- Main question-answer chain semantics:
  - [architecture/system/execution-agent-layer-architecture.md](./architecture/system/execution-agent-layer-architecture.md)
  - [architecture/system/capability-routing-and-admission-architecture.md](./architecture/system/capability-routing-and-admission-architecture.md)
  - [architecture/current-architecture.md](./architecture/current-architecture.md)
- Durable execution, Temporal, run/event/step projection, resume and cancel:
  - [architecture/system/durable-agent-runtime-architecture.md](./architecture/system/durable-agent-runtime-architecture.md)
- Tool or capability readiness:
  - [architecture/domains/README.md](./architecture/domains/README.md)
  - [contracts/README.md](./contracts/README.md)
- Data source truth, source-channel schema and read-model ownership:
  - [data/README.md](./data/README.md)
- HTTP/runtime wire contracts, DTOs and tool contracts:
  - [contracts/README.md](./contracts/README.md)
- ADR reasoning and supersession:
  - [decisions/README.md](./decisions/README.md)
- Deployment, staging, release, recovery or smoke procedure:
  - [runbooks/README.md](./runbooks/README.md)
  - [environment/README.md](./environment/README.md)
  - [policies/README.md](./policies/README.md)
- Current work map and backlog signals:
  - [../.planning/PROJECT.md](../.planning/PROJECT.md)
  - [../.planning/WORKSTREAMS.md](../.planning/WORKSTREAMS.md)

## Documentation Areas

- [architecture/README.md](./architecture/README.md)
  - product, current, target and supporting architecture entry
- [architecture/system/README.md](./architecture/system/README.md)
  - cross-domain runtime, execution, retrieval, data and observability boundaries
- [architecture/domains/README.md](./architecture/domains/README.md)
  - domain/capability architecture boundaries
- [domains/README.md](./domains/README.md)
  - cross-document domain hub
- [contracts/README.md](./contracts/README.md)
  - contract truth for HTTP, runtime and capability seams
- [data/README.md](./data/README.md)
  - data truth, source truth schemas and read-model ownership
- [decisions/README.md](./decisions/README.md)
  - ADR lifecycle and accepted decision reasoning
- [reference/README.md](./reference/README.md)
  - glossary, inventory, matrices, baselines and reference material
- [runbooks/README.md](./runbooks/README.md)
  - operational procedure and release/staging/smoke runbooks
- [environment/README.md](./environment/README.md)
  - env ownership, provider and secret inventory
- [policies/README.md](./policies/README.md)
  - governance rules, thresholds and collection-specific policies

## Non-Ownership Rules

- `.planning/` is a compact work map. It does not override architecture,
  contract, data or ADR truth.
- `runbooks/` define operational procedures and release evidence. They do not
  define whether the main answer chain is architecturally complete.
- Capability/domain docs define capability-local readiness. They do not
  redefine main-chain completion.
- `current-architecture.md` describes accepted merged truth. It does not carry
  feature-branch progress or release closeout.
- `target-architecture.md` describes long-term invariants. It does not carry
  P0/P1/P2 status or current implementation progress.

## Historical Material

Tracked planning archive trees have been removed from branch tip. Historical
planning material is recovered through git history. If a historical decision,
requirement or evidence reference is still needed, promote that specific fact
into the correct active document class instead of restoring the archive tree.
