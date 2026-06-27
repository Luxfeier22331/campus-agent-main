---
doc_type: documentation_architecture
truth_scope: repository
owner_boundary: docs
status: active
created: 2026-06-13
updated: 2026-06-13
---

# Documentation Architecture

## Document Boundary

This document defines the source-of-truth architecture for `campus-agent`
documentation.

It answers:

- which class of fact each document type is allowed to own
- which document wins when two documents appear to conflict
- which content must be moved instead of repeated
- how to distinguish architecture truth, contract truth, operational truth and
  planning truth

It does not answer:

- whether a specific product feature is complete
- which backlog item should be implemented next
- how to deploy, smoke, release or operate a runtime surface
- detailed contract fields, schemas, ADR reasoning or domain-specific source
  truth

## Core Rule

`campus-agent` uses a Source-of-Truth documentation architecture.

Every durable fact must have exactly one owning document class. Other documents
may link to that fact, summarize it briefly, or explain how to consume it, but
they must not redefine it.

The primary failure mode this architecture prevents is mixing product chain
truth, capability readiness, operator/eval diagnostics, release evidence,
staging proof and active planning into the same paragraph.

Human documentation must also stay small enough to keep that ownership
observable:

- Use directories for context and short filenames for the object itself.
  Prefer `domains/transport.md` over repeating the full path context in the
  filename.
- A narrow capability has one canonical human document. Architecture, contract,
  data, config README and audit notes may link to it, but they must not each
  restate the same capability truth.
- Machine-readable JSON Schema, OpenAPI and fixtures may remain separate
  executable contracts. They do not justify parallel human prose documents for
  the same narrow capability.
- ADRs keep their historical lifecycle. Do not delete or rename ADRs only to
  satisfy short-name cleanup; supersede them when the decision changes.
- Archive directories are not long-term garbage drawers. Historical full text
  stays tracked only when it still carries unique retained evidence or
  migration value. If the remaining value is traceability, use git history
  instead of keeping a branch-tip body or redirect stub.
- The documentation inventory is a compact governance snapshot, not a
  hand-maintained mirror of every Markdown file. It should record counts,
  cleanup rules and hotspots rather than duplicate the full tree.

## Truth Classes

### `product_truth`

- Owns: product boundary, target users, product promises and explicit
  non-promises.
- Default location: `docs/architecture/product-positioning.md`.
- Must not own: runtime progress, release evidence or capability implementation
  status.

### `product_requirement`

- Owns: feature-level PRDs, launch-facing user experience requirements and
  acceptance criteria.
- Default location: `docs/product/`.
- Must not own: product positioning, current merged truth, target architecture,
  wire contracts, data schemas, operational run steps or active work status.

### `current_truth`

- Owns: current accepted merged topology and serving surfaces.
- Default locations: `docs/architecture/current-architecture.md` and the compact
  repo state in `.planning/PROJECT.md`.
- Must not own: backlog, target-state design, feature-branch state or staging
  closeout.

### `target_invariant`

- Owns: long-term architecture constraints and non-regression boundaries.
- Default location: `docs/architecture/target-architecture.md`.
- Must not own: current completion, P0/P1/P2 status, staging evidence or
  one-off implementation order.

### `supporting_architecture`

- Owns: cross-domain owner boundaries, runtime semantics and system design.
- Default location: `docs/architecture/system/`.
- Must not own: workstream progress, release proof or domain source-channel
  details.

### `domain_architecture`

- Owns: capability/domain boundary and source-channel architecture.
- Default location: `docs/architecture/domains/`.
- Must not own: main-chain completion status, operator/release evidence or
  cross-domain runtime ownership.

### `contract_truth`

- Owns: HTTP/runtime wire contracts, DTOs, tool contracts and schema-adjacent
  interfaces.
- Default location: `docs/contracts/`.
- Must not own: product positioning, implementation roadmap or operational run
  steps.

### `data_truth`

- Owns: source truth schemas, read-model ownership and canonical data
  boundaries.
- Default location: `docs/data/`.
- Must not own: architecture rationale, runbook procedure or planning status.

### `decision_record`

- Owns: accepted architecture decisions, supersession and reasoning.
- Default location: `docs/decisions/`.
- Must not own: active work status, command checklists or detailed inventory
  matrices.

### `operational_truth`

- Owns: deployment, smoke, staging, recovery and release procedures.
- Default locations: `docs/runbooks/`, `docs/environment/` and
  `docs/policies/`.
- Must not own: architecture completion definition, product promises or
  target-state invariants.

### `planning_work_map`

- Owns: current work map, backlog signals and session-independent planning
  pointers.
- Default locations: `.planning/PROJECT.md` and `.planning/WORKSTREAMS.md`.
- Must not own: long-term architecture truth, current merged topology override
  or historical phase ledger.

### `reference`

- Owns: glossary, matrices, inventories, quality baselines and stable
  explanatory reference.
- Default location: `docs/reference/`.
- Must not own: active workstream state, architecture owner decisions or
  procedural run steps.

## Conflict Resolution Order

When documents appear to disagree, apply this order before changing code or
implementing a plan:

1. `product_truth` defines what the product is and is not.
2. `product_requirement` defines feature-level user experience requirements and
   acceptance criteria.
3. `target_invariant` defines long-term boundaries that must not regress.
4. `current_truth` defines what is already accepted at the branch tip.
5. `supporting_architecture` defines cross-domain system ownership.
6. `domain_architecture` defines capability-local boundaries.
7. `contract_truth` and `data_truth` define executable wire/schema truth.
8. `decision_record` explains why a decision was accepted and how it was
   superseded.
9. `operational_truth` defines how to operate or verify a system.
10. `planning_work_map` defines what work is currently queued or signaled.
11. `reference` provides stable lookup material but does not override the owner
    classes above.

If the document with lower precedence is more recent, do not silently treat it
as a replacement. Promote the change into the owning document class or write a
new ADR.

## Canonical Question Routing

- What is this product and what does it not promise?
  - Owning class: `product_truth`
  - First place: `docs/architecture/product-positioning.md`
- What should a feature deliver for users?
  - Owning class: `product_requirement`
  - First place: `docs/product/`
- What is currently merged and accepted?
  - Owning class: `current_truth`
  - First place: `docs/architecture/current-architecture.md`
- What must the architecture converge to?
  - Owning class: `target_invariant`
  - First place: `docs/architecture/target-architecture.md`
- Is the main question-answer chain closed?
  - Owning classes: `supporting_architecture` and `current_truth`
  - First places: primary-agent / execution-chain architecture and
    `current-architecture.md`
- Is a specific tool or capability product-ready?
  - Owning classes: `domain_architecture` and `contract_truth`
  - First places: the capability domain doc and matching contract
- Is answer grounding sufficient?
  - Owning class: `contract_truth` or a domain-specific answer contract
  - First place: capability answer/evidence contracts
- Is release or staging evidence sufficient?
  - Owning class: `operational_truth`
  - First place: release and staging runbooks
- How does resume, cancel or replay behave?
  - Owning class: `supporting_architecture`
  - First place: durable runtime architecture
- Why did we accept a boundary?
  - Owning class: `decision_record`
  - First place: matching ADR
- What work remains?
  - Owning class: `planning_work_map`
  - First places: `.planning/PROJECT.md` and `.planning/WORKSTREAMS.md`

## Main Chain Completion Rule

Main question-answer chain completion is judged only by the generic online
execution skeleton:

`app-api -> execution-control -> Temporal -> memory recall -> primary agent
decision -> direct/no-tool finalization or admitted capability branch ->
sanitized finalization projection`

The following must not be counted as main-chain blockers unless they break that
generic execution skeleton:

- maturity of individual tools or capability content
- notice, campus-services, navigation or RAG answer quality
- Operator Console, eval, badcase or release evidence consumption
- staging closeout, production smoke or release proof
- future multi-step workflow coverage
- replay or repair features beyond existing event-stream resume

Capability readiness, operator diagnostics and release evidence remain
important, but they live in their own truth classes.

## Evidence Terminology

The unqualified word `evidence` is ambiguous in this repository. New or edited
docs should prefer one of these terms:

- `answer_grounding_evidence`: source material, citations, retrieval support,
  grounding verdicts or bounded artifacts used to support an answer.
- `release_evidence`: staging, smoke, closeout, deploy, readiness or regression
  proof used to accept a release or operational change.
- `operator_diagnostic_evidence`: sanitized trajectory, step, attempt, metric or
  trace-derived facts used by operator/eval/badcase surfaces.

Do not use release evidence to define whether the online main chain is
architecturally closed. Do not use answer grounding evidence as a substitute
for release closeout.

## Content Ownership Rules

### Large Documents

Large documents are allowed only when they are owner-clean.

A large document is owner-clean when:

- it has one truth class
- its frontmatter owner boundary matches the content it owns
- it does not redefine another document class
- it is not carrying active work status, release proof or staging closeout unless
  it is an operational runbook

Large but owner-clean documents should be marked in the documentation inventory
with `keep_large_owner_truth`. That action means the document was reviewed and
should not be split only to reduce line count. Future additions still need to
respect the same owner boundary.

If a large document mixes truth classes, split the mixed section into the owning
document class before adding new content. Do not leave durable docs with
permanent `audit_split_boundary` or `split_or_compress` actions after the
governance pass.

### Current Truth

`current_truth` documents may say what is merged and accepted. They must not
carry:

- `remaining gap`
- `next work`
- `staging closeout`
- `opening evidence`
- `future target`
- active phase status

If a current-truth document needs to mention deferred work, link to the owning
planning or runbook document without restating its details.

### Target Invariants

`target_invariant` documents may say what must remain true in the long term.
They must not carry:

- current completion status
- P0/P1/P2 work labels
- runbook proof state
- staging or release evidence
- implementation-order checklists

### Supporting Architecture

`supporting_architecture` documents may define boundaries, ownership and runtime
semantics. They must not become mega-documents that own every related domain.
When a section becomes capability-specific, move it to `domain_architecture`.
When a section becomes an executable schema or wire contract, move it to
`contract_truth` or `data_truth`.

### Operational Truth

`operational_truth` documents may define commands, checks, deployment steps,
smoke steps and release evidence requirements. They must not define whether a
product or architecture target is correct.

### Planning Work Map

`.planning/` documents are compact work maps. They may point to backlog signals
and active lanes. They must not override architecture, contract, data or ADR
truth.

### Reference Graph

Active and accepted documents must not use historical, superseded, deprecated or
retired compatibility documents as current owner truth.

Allowed historical references are limited to explicitly labeled historical /
archive / superseded-background context. Internal compatibility entries do not
survive as source-of-truth documents; migrate their references to the current
owner document or delete the stale route.

Concrete internal Markdown references in active and accepted documents must
resolve to an existing file. Glob patterns, route placeholders and external
absolute paths are not treated as concrete source-of-truth references.

Markdown paths must not be split across lines. If a path is too long for normal
prose, use a shorter relative path or a Markdown link label instead of breaking
the `.md` suffix.

## Frontmatter Target

New durable docs should use:

```yaml
---
doc_type: <truth class or existing doc type>
truth_scope: <product | execution | capability | data | ops | eval | repository>
owner_boundary: <owning app/package/domain/docs boundary>
status: <active | historical | proposed | accepted | superseded | deprecated>
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Existing docs may keep their current frontmatter until the Phase 5 migration,
but new docs should not introduce new ambiguous `doc_type: architecture`
without `truth_scope` and `owner_boundary`.

## Migration Rules

- Move content to the owning truth class; do not duplicate it in place.
- Preserve ADR history; if a decision changes, supersede it instead of deleting
  it.
- Preserve historical reference/runbook value by marking it `historical` or
  moving it under `archive/`, not by leaving it on the default reading path.
- Delete historical archive bodies that no longer carry unique retained
  evidence or migration value. Use git history for traceability instead of
  keeping tracked redirect stubs.
- Do not restore tracked planning archive trees. Recover only specific durable
  facts into active docs.
- Prefer deleting stale cross-type summaries over maintaining compatibility
  notes that repeat another document's truth.
- Remove internal compatibility entries after their references are migrated.

## Related Documents

- `docs/decisions/adr-0038-documentation-information-architecture-and-lifecycle.md`
- `docs/decisions/adr-0039-reference-and-runbook-historical-lifecycle.md`
- `docs/reference/documentation-inventory.md`
