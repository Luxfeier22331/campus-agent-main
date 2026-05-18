---
doc_type: phase_plan
phase: "11"
phase_name: "Second-Batch Manual-Review Admission"
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 11 Plan

## Objective

Promote the two Phase 6R manual-review regulation rows whose owner text is now
ready into explicit selected target materialization, without opening query
serving, RAG release, public reader, or public-chat citation.

Selected cohort:

- `481` -> `regulations/scoped_rules`
- `619` -> `regulations/institutional_rules`

## Why This Phase Exists

Phase 9 deliberately excluded `manual_review` rows even when owner text had been
recovered. That was correct because `manual_review` means the target collection
must not be inferred automatically.

Phase 11 adds the missing explicit resolution boundary:

- manual-review source rows must remain deferred by default;
- operator/review resolution must name the target collection;
- owner text must still be `ready`;
- selected promotion can materialize only the resolved rows;
- serving and RAG release stay closed.

## Locked Inputs

- upstream candidate audit:
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1-regulation-candidate-audit-and-admission/regulation-candidate-audit.json`
- owner-text execution report:
  `.planning/workstreams/collected-notice-consumption-replay-closeout/evidence/phase-06-r1b-regulation-owner-text-recovery-execution/regulation-owner-text-execution-report.json`
- explicit resolutions:
  - `481`: `scoped_rules`
  - `619`: `institutional_rules`

## Implementation Tasks

1. Add an explicit manual-review resolution builder.
2. Require selected rows to have source class `manual_review`.
3. Require owner-text execution status `ready`.
4. Emit a resolved admission manifest and resolved candidate audit.
5. Reuse selected target materialization guards with Phase 11 phase identity.
6. Execute selected target materialization for `481` and `619`.
7. Emit serving-closed evidence.
8. Update workstream planning truth.

## Exit Rule

Phase 11 is complete when:

- both selected rows materialize into target registry/document artifacts;
- target postflight counts increase only for selected target scopes;
- quality and consistency reports pass;
- query serving and RAG release remain closed;
- remaining `needs_multimodal` rows stay out of scope.
