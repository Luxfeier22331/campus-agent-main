---
doc_type: plan
status: active
created: 2026-03-23
updated: 2026-03-23
---

# Golden Dataset Schema And Bootstrap

**Goal:** Define the first executable golden dataset schema for `campus-agent`, aligned with ADR-0003 / ADR-0004, while accepting a `synthetic-heavy` bootstrap strategy and keeping downstream scorer/runtime integrations replaceable.

**Architecture:** This document does not replace the long-term governance ADRs. It translates them into a phase-1 executable schema shape, bootstrap split strategy, provenance rules for synthetic cases, and the minimum deterministic grading surface that `packages/evals` should support before richer LLM graders or larger datasets exist.

**Tech Stack:** Markdown, Python dataclasses in `packages/evals`, deterministic graders, optional adapters for Ragas / Promptfoo / Langfuse / Phoenix

---

## Summary

The first golden dataset implementation should optimize for:

- minimal but stable case protocol
- synthetic-heavy generation with explicit provenance
- deterministic grading before LLM grading
- doc-level retrieval truth first, chunk-level truth only where stable
- split governance that does not create more maintenance overhead than signal

This plan intentionally does **not** freeze:

- the first full `student_handbook` case inventory
- generator implementation details
- any release threshold values
- any single external evaluator format as canonical truth

## Phase-1 Bootstrap Position

Current project constraints:

- there is not enough human labeling capacity for a manually authored large golden set
- `student_handbook` ingestion and retrieval truth are still stabilizing
- specialist and eval protocol need deterministic closure before broad scorer experimentation

Therefore phase-1 should adopt:

- `synthetic-heavy but schema-first`
- `doc-level retrieval truth first`
- `deterministic-only grading by default`

This remains consistent with:

- `docs/decisions/adr-0003-golden-dataset-governance.md`
- `docs/decisions/adr-0004-evaluation-metrics.md`

## Canonical Schema Direction

Each golden case should be treated as a repository-owned protocol, not as a direct Ragas/Promptfoo/OpenAI eval row.

### Required semantic layers

- input and actor context
- workflow truth
- retrieval truth
- answer truth
- provenance and generation metadata
- grader policy

### First bootstrap field set

Required fields:

- `case_id`
- `split`
- `source_type`
- `user_goal`
- `actor`
- `corpora`
- `expected_status`
- `expected_sources`
- `forbidden_sources`
- `required_facts`
- `forbidden_claims`
- `trace_expectation`
- `grader_policy`

Bootstrap extension fields now recommended because the dataset is synthetic-heavy:

- `generator_name`
- `generator_version`
- `generation_recipe`
- `seed_case_id`
- `tags`
- `notes`
- `metadata`

## Retrieval Truth Policy

Phase-1 bootstrap should not require every case to lock to `chunk_id`.

Recommended matching strictness:

- baseline default: `doc_id`
- when stable and valuable: `doc_id + version_id`
- only for locked/high-risk cases: `doc_id + version_id + chunk_id`

Rationale:

- chunking policy and retrieval ranking are still evolving
- doc-level truth is much easier to synthesize and validate
- forcing chunk-level truth too early will create noisy churn in regression sets

`forbidden_sources` follow the same rule: first forbid by `doc_id`, then optionally narrow by `version_id` / `chunk_id`.

## Trace Truth Policy

The first executable trace protocol should stay lightweight.

Bootstrap expectations:

- whether retrieval should happen
- whether clarification should happen
- whether the system should fail closed
- optional selected corpus expectation
- optional handoff target expectation

Do not require full internal trace serialization in the bootstrap phase.

## Split Strategy

The ADR defines four long-term split semantics, but bootstrap should only actively populate two:

- `smoke`
- `regression_locked`

Recommended usage:

- `smoke`: minimal happy path plus key fail-closed path
- `regression_locked`: only the most expensive or risky cases
- `exploratory`: allowed but not required at bootstrap
- `release_gate`: can initially be derived from a stable subset of `smoke` + `regression_locked`

## Synthetic-Heavy Provenance Rules

Because the project currently relies on synthetic or pseudo-labeled data, provenance must be explicit per case.

For `synthetic_expansion` cases:

- `generator_name` should identify the generator family
- `generator_version` should identify the generator build or prompt/template revision
- `generation_recipe` should describe the recipe class, not necessarily the full prompt
- `seed_case_id` should be used when a case is derived from an earlier template/example

Promotion rules:

- raw generator output is not yet canonical truth
- canonicalization happens only after repository schema completion plus rule-based validation
- `regression_locked` should contain only synthetic cases whose truth can be validated deterministically or whose risk justifies explicit lock-in

## Grader Policy Bootstrap

Default bootstrap mode:

- `deterministic_only`

Deterministic checks should cover:

- `status_accuracy`
- `expected_doc_hit`
- `forbidden_doc_miss`
- `required_facts`
- `forbidden_claims`
- `citation_completeness`

Optional bootstrap checks when the signal already exists:

- `acl_fail_closed`
- `error_path_correctness`

Do not make LLM grading mandatory for bootstrap readiness.

## External Library Adapter Strategy

The canonical schema stays repository-owned. External libraries consume adapters.

### Ragas

Useful for:

- synthetic query generation patterns
- evaluation samples centered on `user_input`, `reference`, `retrieved_contexts`

Not canonical for:

- actor truth
- ACL truth
- trace truth
- release-gate repository protocol

### Promptfoo

Useful for:

- assertion-oriented execution
- simple deterministic + rubric-style checks

Not canonical for:

- golden truth storage model

### Langfuse / Phoenix

Useful for:

- dataset registry and experiment tracking
- metadata-rich dataset items

Not canonical for:

- workflow truth semantics

## Implementation Targets

The first implementation pass should align these files:

- `packages/evals/src/campus_evals/models.py`
- `packages/evals/src/campus_evals/expectations.py`
- `packages/evals/src/campus_evals/scenarios.py`
- `tests/evals/test_golden_cases.py`

Expected protocol changes:

- expected/forbidden source refs allow doc-level matching with optional `version_id` / `chunk_id`
- grader policy exposes explicit mode/checks instead of only hidden booleans
- synthetic provenance fields exist on `GoldenCase`
- smoke bootstrap scenarios remain small and phase-1 aligned

## Acceptance Criteria

This plan is complete when:

- a first executable canonical schema direction is documented outside the ADRs
- `packages/evals` implements the bootstrap protocol shape
- tests prove doc-level source matching works
- the current protocol supports synthetic-heavy provenance without binding to any external evaluator format

## Deferred

- full JSON/YAML on-disk dataset file format
- generator implementation and sampling pipeline
- LLM grader prompt/rubric definitions
- chunk-level truth for most cases
- release thresholds and CI gate numbers
