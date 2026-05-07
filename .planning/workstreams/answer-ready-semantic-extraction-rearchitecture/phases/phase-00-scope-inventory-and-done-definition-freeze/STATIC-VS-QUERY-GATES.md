---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Static Release Gates Vs Query-Conditioned Eval

## Rule

Release admission validates whether chunks and metadata are internally valid for serving. It does
not decide whether a particular user query should select a particular chunk.

Query-conditioned contradictions belong to retrieval ranking, evidence selection, typed draft,
grounding and component eval.

## Static Gate Responsibilities

Allowed in chunk/release quality gates:

- required v3 fields by answer role
- contract version
- parent/child unit ids
- condition group id when required
- taxonomy value validity
- procedure typed fields
- category overview member ids/titles
- intro non-answer-bearing metadata
- polarity internally consistent with answer role
- table fact answer-ready metadata
- no heading-only / boilerplate / attachment-ref serving chunks

## Query-Conditioned Responsibilities

Owned by retrieval/component eval:

- positive procedure query selects procedure evidence over exclusion evidence
- negative restriction query selects exclusion/prohibition evidence
- category discovery selects category overview and enough member policies
- rank query selects rank-threshold evidence
- paper query selects paper/publication evidence
- selected evidence is not repeated same parent unit without added coverage
- draft kind matches user intent
- grounding covers every claim/list item/step

## Invalid Gate Placement Examples

- Invalid: release gate fails because the query `处分怎么消` would select an exclusion chunk.
- Valid: release gate fails because an exclusion chunk has invalid polarity metadata.
- Invalid: release gate requires a scholarship query to prove category discovery behavior.
- Valid: release gate requires category overview chunks to include member document ids and titles.
- Invalid: component eval accepts a chunk with missing `condition_subject` because final answer text
  looked correct.
- Valid: component eval reports `semantic_contract_mismatch` when selected evidence metadata fails
  the oracle.
