---
doc_type: index
truth_scope: repository
owner_boundary: docs
status: active
created: 2026-03-22
updated: 2026-07-08
---

# Docs

`docs/` is the long-lived documentation surface for `campus-agent`.

The repository uses mature documentation standards with a thin Source-of-Truth
mapping layer. Use Diataxis, MADR / ADR, OpenAPI / JSON Schema, RFC 2119 / RFC
8174 and GitHub-native templates for their respective surfaces. Read
`documentation-architecture.md` when a question depends on which document owns a
fact or which document wins a conflict.

## Start Here

- Product boundary, users and non-promises:
  [architecture/product.md](./architecture/product.md)
- Current accepted merged truth:
  [architecture/current.md](./architecture/current.md)
- Long-term architecture invariants:
  [architecture/target.md](./architecture/target.md)
- Documentation ownership, truth classes and conflict resolution:
  [documentation-architecture.md](./documentation-architecture.md)
- Stable cross-owner visual map:
  [architecture/flows.md](./architecture/flows.md)
- Active planning signals:
  [../.planning/PROJECT.md](../.planning/PROJECT.md) and
  [../.planning/WORKSTREAMS.md](../.planning/WORKSTREAMS.md)

## Areas

- [architecture/README.md](./architecture/README.md)
  - product, current, target and supporting architecture entry
- [product/README.md](./product/README.md)
  - feature-level PRDs and launch-facing user experience requirements
- [architecture/system/README.md](./architecture/system/README.md)
  - cross-domain runtime, execution, retrieval, data and observability
    boundaries
- [architecture/domains/README.md](./architecture/domains/README.md)
  - domain and tool architecture boundaries
- [domains/README.md](./domains/README.md)
  - narrow human capability docs and direct owner routing
- [contracts/README.md](./contracts/README.md)
  - contract truth for HTTP, runtime and tool seams
- [data/README.md](./data/README.md)
  - data truth, source truth schemas and read-model ownership
- [decisions/README.md](./decisions/README.md)
  - ADR lifecycle and accepted decision reasoning
- [reference/README.md](./reference/README.md)
  - glossary, matrices, baselines and stable reference material
- [runbooks/README.md](./runbooks/README.md)
  - operational procedure and release/staging/smoke runbooks
- [environment/README.md](./environment/README.md)
  - env ownership, provider and secret inventory
- [policies/README.md](./policies/README.md)
  - governance rules, thresholds and collection-specific policies

## Question Routing

- "What is this product and what does it not promise?"
  - `architecture/product.md`
- "What is already merged and accepted?"
  - `architecture/current.md`
- "What must the architecture converge to?"
  - `architecture/target.md`
- "Which document owns this kind of fact?"
  - `documentation-architecture.md`
- "How do major runtime/data/eval chains cross owner boundaries?"
  - `architecture/flows.md`
- "How does one runtime, source channel, API, data model or operation work?"
  - Start from the relevant area README above, then follow its owner document.
- "What work remains?"
  - `.planning/PROJECT.md` and `.planning/WORKSTREAMS.md`
- "How are public source data, license and attribution governed?"
  - `policies/public-source-data.md`, `reference/open-source-data.md`,
    `../LICENSE`, `../NOTICE` and `../THIRD_PARTY_NOTICES.md`

## Non-Ownership Rules

- `.planning/` is a compact planning signal surface. It does not override
  architecture, contract, data or ADR truth.
- `runbooks/` define operational procedures and closeout artifact rules. They
  do not define whether the main answer chain is architecturally complete.
- Domain/tool docs define local readiness. They do not redefine main-chain
  completion.
- `current.md` describes accepted merged truth. It does not carry feature-branch
  progress or release closeout.
- `target.md` describes long-term invariants. It does not carry P0/P1/P2 status
  or current implementation progress.
- Reference material can support a discussion, but contracts, data schemas and
  architecture docs own current product/runtime/data truth.
- Historical planning material must be promoted into the correct active
  document class before it can be cited as current truth.

## Historical Material

Tracked planning archive trees have been removed from branch tip. Historical
planning material is recovered through git history. If a historical decision,
requirement or retained output is still needed, promote that specific fact into
the correct active document class instead of restoring the archive tree.
