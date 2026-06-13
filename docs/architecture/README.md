---
doc_type: index
truth_scope: repository
owner_boundary: docs/architecture
status: active
created: 2026-04-12
updated: 2026-06-13
---
# Architecture

`architecture/` owns product, current, target and supporting architecture truth.
It explains what the system is, how owner boundaries are split, and which
boundaries must not regress.

It does not own contracts, data schemas, runbook procedure, release evidence or
planning status.

## Repo Entry Truth

- `product-positioning.md`
  - product boundary, target users and explicit non-promises
- `current-architecture.md`
  - current accepted merged-truth snapshot
- `target-architecture.md`
  - long-term architecture invariants and non-regression boundaries

## Supporting Architecture Layout

- `system/README.md`
  - cross-domain supporting architecture for runtime, execution, retrieval,
    data-plane, observability and related system boundaries
- `domains/README.md`
  - domain architecture for navigation, official-web, authenticated notice,
    campus services and other capability/domain boundaries

## Related Truth Owners

- Source-truth schemas live in `docs/data/`, not in architecture docs.
- Runtime and HTTP contracts live in `docs/contracts/`.
- Accepted decision reasoning lives in `docs/decisions/`.
- Deployment, staging, release and recovery procedures live in `docs/runbooks/`,
  `docs/environment/` and `docs/policies/`.
- Current work maps live in `.planning/PROJECT.md` and
  `.planning/WORKSTREAMS.md`.

## Question Routing

- "What is the product?" -> `product-positioning.md`
- "What is already merged and accepted?" -> `current-architecture.md`
- "What must the system converge to?" -> `target-architecture.md`
- "How does a cross-domain runtime or owner boundary work?" -> `system/`
- "How does one capability/domain work?" -> `domains/`

## Use Rules

- `current-architecture.md` writes merged truth only.
- `target-architecture.md` writes long-term invariants only.
- Supporting architecture explains boundaries and owners, not one-off plans or
  execution history.
- Cross-domain supporting architecture belongs in `system/`.
- Domain-specific architecture belongs in `domains/`.
- Canonical source-truth artifacts and schemas belong in `docs/data/`, not in
  explanation-oriented architecture docs.
