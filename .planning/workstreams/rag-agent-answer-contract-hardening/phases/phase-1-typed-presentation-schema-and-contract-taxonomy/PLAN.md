---
doc_type: plan
status: completed
created: 2026-05-10
updated: 2026-05-10
---

<!-- markdownlint-disable MD013 -->

# Phase 1: Typed Presentation Schema And Contract Taxonomy

## Goal

Introduce explicit answer presentation kinds inside `packages/rag-agent` so the composer can
validate a short-answer draft before rendering prose.

## Scope

- define package-local presentation kinds for:
  - document identity
  - brief reference
  - short factual summary
  - generic fallback
- define validation rules for:
  - maximum fragments
  - maximum sentences
  - allowed qualifiers
  - required identity token presence
  - draft kind / answer-shape compatibility
- keep the schema internal to `rag-agent`; do not promote it into `packages/contracts`
- connect the schema to the existing `TypedAnswerDraft` / validation helpers rather than adding a
  second answer truth
- add unit tests for valid and invalid presentation drafts
- add focused tests for the draft-to-shape mapping used by title, curriculum identity, official-web
  brief and generic fallback paths

## Deliverables

- internal typed presentation schema
- validation helpers shared by composers and tests
- tests that reject overlong, shape-mismatched, or unsupported drafts

## Verification

- `tests.agent.rag_agent_typed_answer_drafts_suite`
- `tests.agent.rag_agent_answer_quality_regression_suite`
- `tests.agent.rag_agent_request_prompt_contract_suite`
- targeted composer contract tests around invalid overlong drafts, missing identity tokens and
  unsupported fallback drafts

## Exit Criteria

- the schema is shared by composers and tests
- invalid overlong drafts fail fast
- the taxonomy is stable enough for shape-specific routing
- the schema stays internal to `packages/rag-agent`
- draft validation fails when shape and presentation kind diverge

## Status

Completed. See `./SUMMARY.md`.
