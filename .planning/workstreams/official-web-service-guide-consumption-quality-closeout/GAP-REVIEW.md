---
doc_type: review
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Gap Review

This file is the resumable Phase 0 evidence anchor for
`official-web-service-guide-consumption-quality-closeout`.

## Reviewed Current Facts

- `service_guide_lookup` currently exposes a flat request/result contract with `guide_focus`,
  `guide_sections`, `required_materials`, `entry_refs`, `office_hours`, `contact_refs` and
  `source_refs`.
- `campus_services/service_guide` current data contract is
  `campus_services_service_guide_projection.v1`; it has `guide_sections[]` and no canonical grouped
  procedure shape.
- Go structured query runtime reads service-guide records through typed query structs and PostgreSQL
  current projection/read-model semantics, not query-time source bundles.
- `campus-services-agent` currently renders service-guide answers by concatenating all returned
  sections/materials/entries/hours/contacts.
- official-web target-first architecture requires target-source-map admission, source refs,
  ingestion-owned selected-write release, and no query-time stitching of source pages.

## Frozen Gaps

### G1: Cross-Language Contract Is Not Canonical Enough

The current plan must not stop at prose docs. The grouped procedure and focused answer shape must be
frozen across:

- `docs/contracts/service-guide-lookup-contract.md`
- `docs/data/campus-services-service-guide-source-truth-schema.md`
- `packages/contracts` Python dataclasses and shared literals
- Go structured query request/result/read-model structs
- app-api/panel TypeScript parsers or operator-safe projections if they consume the result details
- eval/provider function schema fixtures where `service_guide_lookup` is exposed
- golden JSON fixtures that prove Python, Go and TypeScript agree on the same shape

Exit rule: no implementation phase may introduce grouped service-guide fields without a matching
contract/golden drift test.

### G2: Typed Read Model Migration Is Underspecified

The current projection contract says runtime serving truth is PostgreSQL release catalog plus typed
read model. Adding `procedure_groups` only to object projection is insufficient.

Exit rule: Phase 3 must define and test schema versioning, read-model persistence, backfill or
compatibility projection, and rollback behavior for existing records.

### G3: Composition Must Be Declarative, Not "Where Feasible"

Information disclosure and email service currently need multi-page composition. This must be driven
by target/source role metadata, not by page-title branches or one-off inventory IDs.

Exit rule: Phase 2 must update target-source-map/source-pack role schema and validators, then prove
invalid or ambiguous composition fails closed.

### G4: Preview And Release Proof Must Be Split

No-promotion replay and selected-write release proof have different side effects. They must be
separate gates.

Exit rule: Phase 7 produces no-promotion artifacts only. Phase 8 may publish only to an explicitly
accepted local target environment with isolated PG schema/object prefix and cleanup evidence.

### G5: Planner Focus Is Part Of Runtime Quality

`guide_focus` is selected upstream by supervisor structured planning. Focused answer shaping cannot
be verified only inside `campus-services-agent`.

Exit rule: Phase 4/6 must cover planner cases for entry, procedure, required materials, contact,
office hours, eligibility and full guide.

### G6: Eval Criteria Must Be Machine-Verifiable

"No overlong dump" and "focused answer" need deterministic thresholds.

Exit rule: Phase 6 must define section count, token/character budget, required tokens, forbidden
tokens, source URL coverage and field-source coverage assertions.

### G7: Phase 0 Evidence Must Survive Chat History Loss

The workstream must be resumable from files alone.

Exit rule: this file plus `ROADMAP.md`, `REQUIREMENTS.md`, `STATE.md` and phase `PLAN.md` files are
the planning truth for follow-up implementation.
