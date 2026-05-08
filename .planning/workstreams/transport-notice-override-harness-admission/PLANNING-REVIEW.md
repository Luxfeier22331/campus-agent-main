---
doc_type: planning_review
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 MD060 -->

# Planning Review

## Verdict

The workstream direction is correct, but the original backlog stub was not executable. It named the
right future capability without specifying the contract, data-plane admission gates, owner split,
runtime promotion path or eval trace expectations.

This repair originally moved the workstream from vague backlog stub to executable plan. The
follow-up implementation in the same workstream has now landed through Phase 6; the remaining gap
is focused smoke / opening evidence, not contract or runtime design ambiguity.

## Findings Fixed

### High: `notice_change_set` Had No Contract

Original issue:

- `notice_change_set` existed only as a registry placeholder.
- There was no schema, producer, source-truth owner, admission gate or fail-close reason set.

Fix:

- Added `NOTICE-CHANGE-SET-CONTRACT.md`.
- Roadmap Phase 1 now freezes schema/admission before any runtime graph promotion.
- Roadmap Phase 2 now owns the producer/read-model implementation.

### High: Data-Plane Admission Was Implicit

Original issue:

- The plan did not say when a notice is allowed to become an override answer.
- It did not distinguish admitted change facts from searchable-only notice cards.

Fix:

- Added explicit admission requirements:
  - current official baseline availability
  - transport target classification
  - effective window parsing
  - evidence completeness
  - non-empty title/source URL
  - searchable-only exclusion
  - deterministic conflict semantics
- Runtime must fail closed instead of promoting raw notices at query time.

### Medium: Runtime Promotion Was Too Thin

Original issue:

- The roadmap skipped artifact registry, shared contracts, Go projections, bridge/codegen, workflow
  context projection and finalizer artifact usage.

Fix:

- Expanded `ROADMAP.md` into Phases 0-7.
- Added explicit shared execution contract promotion and finalizer integration phases.
- Added owner matrix for supervisor runtime, notice consumption, campus-services, RAG grounding and
  eval.

### Medium: Eval Denominator Was Incomplete

Original issue:

- Denominator categories were named, but trace expectations were missing.

Fix:

- Added `READINESS-MATRIX.md`.
- Phase 6 now requires artifact kind order, producer ownership, final answer artifact usage and
  no-raw-payload assertions.

### Medium: Owner Boundary Was Negative-Only

Original issue:

- The plan said what not to reopen, but did not say who owns each positive deliverable.

Fix:

- Added `OWNER-RUNTIME-MATRIX.md`.
- Each owner now has concrete responsibilities and forbidden responsibilities.

## Review Constraints Preserved

- Do not reopen `agent-harness-capability-graph-runtime`.
- Do not reopen `notice-consumption-layer` except through this workstream's explicit data-plane
  producer contract.
- Do not let planner keyword branches construct fixed transport override workflows.
- Do not use raw notice/RAG/OCR/HTML/object payloads as query-time truth.
- Do not open public product path without eval/smoke evidence.

## Phase 0+1 Follow-Up Review

After Phase 0+1 execution, two additional issues were found and fixed:

### Medium: Source URL Was Too Tightly Coupled To Projection Metadata

Issue:

- The first admission implementation expected `source_url` to be present in
  `NoticeConsumptionProjectionEntry.role_metadata`.
- Existing notice read-model truth can carry title/source URL separately from projection metadata,
  so this would have pushed Phase 2 toward duplicating source refs in the wrong layer.

Fix:

- `evaluate_transport_notice_change_set_admission(...)` now accepts optional
  `source_title` / `source_url` context.
- The gate still falls back to projection metadata, but no longer requires that projection metadata
  be the only source-ref carrier.
- Added `test_source_title_and_url_can_come_from_read_model_context`.

### Medium: Contract Constants Could Drift From Artifact Registry Placeholder

Issue:

- `models_notice_change_set.py` defined contract names, but no test tied those names to
  `configs/runtime/workflow-artifacts.v1.json`.
- That left room for Phase 2 to implement a producer with a different binding name while the
  registry still showed `planned_contract_gap`.

Fix:

- Added contract tests that assert:
  - artifact kind and display name match the registry placeholder
  - registry still has no producer binding for `notice_change_set`
  - `notice_change_set` is still absent from OpenAPI/Go runtime projection enum before Phase 2

## Residual Risk

The largest residual risk is implementation shortcutting: if future work promotes
`notice_change_set` straight into workflow registry without source-truth admission and eval trace
coverage, this line will recreate the same boundary bug it was created to avoid.

Current residual closeout risk is narrower:

- public/product opening could be claimed without focused smoke over admitted transport override
  samples
- official baseline freshness could drift without refreshed runtime evidence
