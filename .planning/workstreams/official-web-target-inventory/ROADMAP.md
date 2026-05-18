---
doc_type: roadmap
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Official Web Target Inventory

## Overview

This workstream turns official-web target-first collection into an auditable target inventory.

It does not resume broad collection. It starts by freezing downstream surfaces, then defines target
inventory contract, discovers explicit page candidates, validates field completeness, runs
no-promotion preview and hands off only reviewed targets to selected-write release work.

All phases have completed `PLAN.md` and `SUMMARY.md` artifacts. `OUTLINE.md` files remain as
planning breadcrumbs.

## Phase Status

- [x] **Phase 0: Boundary And Inventory Scope** - Freeze workstream boundary, downstream surfaces,
  non-goals, and relationship to prior official-web refactor work.
- [x] **Phase 1: Downstream Surface Taxonomy** - Classify which answer surfaces can consume
  official-web targets and which remain excluded or inventory-only.
- [x] **Phase 2: Inventory Contract And Validation** - Define target inventory schema, validation
  gates and drift checks against consumer-denominator / target-source-map.
- [x] **Phase 3: Candidate Source Discovery** - Build a first explicit target candidate set from
  repo configs, retained source evidence and targeted public official-web pages.
- [x] **Phase 4: Field Completeness Matrix** - Evaluate each candidate against required fields,
  source URL, source version evidence and downstream owner needs.
- [x] **Phase 5: No-Promotion Preview Batch** - Run target-level preview for accepted candidates and
  record staged-only evidence with no current-truth promotion.
- [x] **Phase 6: Selected-Write Readiness** - Classify candidates as ready, blocked, inventory-only
  or excluded, and define release blockers without writing current truth.
- [x] **Phase 7: Operator Inventory Surface** - Ensure app-api / protected panel expose inventory
  state, preview evidence and blocker reasons through the existing operator boundary.
- [x] **Phase 8: Closeout And Handoff** - Record accepted inventory, unresolved blockers, reopen
  rules and handoff to selected-write/release implementation.

## Implementation Dependency

1. Phase 0 and Phase 1 freeze scope before any target list expansion.
2. Phase 2 must complete before adding `target-inventory.json` or validation fields.
3. Phase 3 may only add candidates that fit Phase 1 surfaces.
4. Phase 4 depends on Phase 2 field contract and Phase 3 candidate list.
5. Phase 5 depends on target-first live seam and explicit candidates.
6. Phase 6 depends on preview evidence and field completeness results.
7. Phase 7 depends on stable inventory states and blocker taxonomy.
8. Phase 8 closes only after inventory and handoff records are synchronized.

## Phase Promotion Rule

- Promote one `OUTLINE.md` to `PLAN.md` only after the previous phase has a `SUMMARY.md`.
- Re-check `docs/architecture/domains/official-web/architecture.md`,
  `docs/data/official-web-source-truth-schema.md` and
  `docs/policies/official-web-crawl-policy.md` before any structural change.
- Do not add a target that lacks downstream owner, source evidence and review policy.
- Do not overload `target-source-map.json` with page-level inventory fields; add or change the
  dedicated inventory manifest contract instead.

## Close Rule

Close this workstream only after:

- target inventory contract is documented and validated
- initial target candidate inventory is explicit and source-backed
- every accepted target has no-promotion preview evidence or a recorded blocker
- selected-write readiness is recorded without accidental promotion
- operator review path can explain target state and blockers
- future selected-write implementation has a concrete handoff
