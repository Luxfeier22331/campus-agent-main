---
doc_type: index
truth_scope: repository
owner_boundary: docs/architecture
status: active
created: 2026-04-12
updated: 2026-07-09
---
# Architecture

`architecture/` owns product, current, target and supporting architecture truth.
It explains what the system is, how owner boundaries are split, and which
boundaries must not regress.

It does not own contracts, data schemas, runbook procedure, release-closeout artifacts or
planning status.

## Repo Entry Truth

- `product.md`
  - product boundary, target users and explicit non-promises
- `current.md`
  - current accepted merged-truth snapshot
- `target.md`
  - long-term architecture invariants and non-regression boundaries
- `flows.md`
  - stable cross-boundary flow diagrams; visual map only, not a replacement for
    owner docs

## Supporting Architecture Layout

- `system/README.md`
  - cross-domain supporting architecture for runtime, execution, retrieval,
    data-plane, observability and related system boundaries
- `domains/README.md`
  - domain architecture for navigation, official-web, authenticated notice,
    campus services and other tool/domain boundaries

## Related Truth Owners

- Source-truth schemas live in `docs/data/`, not in architecture docs.
- Runtime and HTTP contracts live in `docs/contracts/`.
- Accepted decision reasoning lives in `docs/decisions/`.
- Deployment, staging, release and recovery procedures live in `docs/runbooks/`,
  `docs/environment/` and `docs/policies/`.
- Active planning signals live in `.planning/PROJECT.md` and
  `.planning/WORKSTREAMS.md`.

## Question Routing

- "What is the product?" -> `product.md`
- "What is already merged and accepted?" -> `current.md`
- "What must the system converge to?" -> `target.md`
- "How does a cross-domain runtime or owner boundary work?" -> `system/`
- "How does one domain or tool boundary work?" -> `domains/`
- "Where is the end-to-end flow diagram for a stable chain?" -> `flows.md`
- "Where is official-web source truth?" ->
  `../data/official-web.md`
- "Where is authenticated notice source truth?" ->
  `../data/authenticated-notice.md`
- "Where is dining operations data truth?" ->
  `../data/dining.md`

## Use Rules

- `current.md` writes merged truth only.
- `target.md` writes long-term invariants only.
- Supporting architecture explains boundaries and owners, not one-off plans or
  execution history.
- Migration-state text must be labeled explicitly as current fact, accepted
  target, reserved / closed capability, retired historical artifact or
  compatibility name/path.
- Cross-domain supporting architecture belongs in `system/`.
- Domain-specific architecture belongs in `domains/`.
- Canonical source-truth artifacts and schemas belong in `docs/data/`, not in
  explanation-oriented architecture docs.
