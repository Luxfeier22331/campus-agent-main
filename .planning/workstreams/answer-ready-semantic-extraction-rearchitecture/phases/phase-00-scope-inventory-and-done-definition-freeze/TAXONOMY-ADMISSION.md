---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Taxonomy Admission

## Owner Boundary

Taxonomy values belong to the regulation-family answer-ready evidence contract. They may live in
`packages/shared` when both ingestion and retrieval consume them, or in `packages/ingestion-core`
only when extraction-internal. Runtime query code may consume taxonomy values but must not invent
new canonical values.

## Controlled Vocabularies

Minimum v3 vocabularies:

- `answer_role`
- `condition_subject`
- `condition_polarity`
- `procedure_action`
- `procedure_actor`
- `category_id`
- `section_kind`
- `intro_scope`
- `draft_kind`

## Admission Rule

A new value requires:

- value name and description
- owner module
- aliases or source patterns
- expected evidence roles
- release blocking/degraded semantics
- at least one fixture row
- retrieval/component eval expectation if query-facing
- version bump or explicit no-version-impact rationale

## Alias Review Rule

Aliases must be reviewed by category:

- source text alias
- section path alias
- query alias
- document/category registry alias

Query aliases alone cannot create ingestion metadata. They may only help query intent map to already
controlled metadata.

## Unknown / Degraded Handling

- Unknown taxonomy values are allowed only as explicit degraded metadata.
- Query-serving answer-ready chunks with required unknown values fail release admission.
- Non-answer-ready or non-serving chunks may retain unknown values with diagnostics.
- Unknown values must appear in quality summaries.

## Release Invalidation

Taxonomy version participates in v3 release readiness. A taxonomy version change must either:

- invalidate old v3 release candidates, or
- produce a compatibility proof that old chunks remain valid under the new taxonomy.

Runtime fallback cannot be used as compatibility proof.

## No One-Off Rule

One-off values for a single query or single Chinese cue are not allowed. If a semantic concept is
needed, it must enter taxonomy admission with fixtures and eval coverage.
