---
doc_type: plan
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Boundary And Field Denominator

## Goal

Freeze the exact service-info expansion boundary before adding or running official-web targets.

## Inputs

- `docs/architecture/domains/official-web/architecture.md`
- `docs/data/official-web-source-truth-schema.md`
- `configs/sources/official_web/muc_public/consumer-denominator.json`
- `configs/sources/official_web/muc_public/target-source-map.json`
- `configs/sources/official_web/muc_public/target-inventory.json`
- `.planning/workstreams/official-web-target-inventory/README.md`
- `.planning/workstreams/official-web-target-inventory/SELECTED-WRITE-HANDOFF.md`
- `.planning/workstreams/official-web-service-info-target-expansion/FIELD-DENOMINATOR.md`

## Tasks

1. Confirm this workstream starts after target inventory closeout.
2. Freeze target surfaces:
   - `campus_services/contact_directory`
   - `campus_services/service_guide`
3. Define required and optional fields for each surface, explicitly reconciling:
   - family-level required evidence in `target-source-map.json`
   - family-level required evidence in `consumer-denominator.json`
   - target-level `required_fields` in `target-inventory.json`
4. Record excluded surfaces:
   - broad crawl
   - news/recent-updates
   - stable-reference unless needed by service-info fields
   - authenticated notice and WeChat source channels
5. Freeze ownership:
   - app-api: control plane and operator projection
   - ingestion-worker: selected-write release execution
   - protected panel: app-api projection only
6. Define the low/no-human rule:
   - `selected_write_requires_review` means ingestion-owned machine field review
   - deterministic extraction passes and proceeds only after review summary is reported
   - deterministic extraction fails and the target is blocked
   - no default human approval queue
7. Reorder future phases so extraction quality and machine review gate are defined before preview.
8. Update workstream registry and state.

## Acceptance Criteria

- README, REQUIREMENTS, ROADMAP and FIELD-DENOMINATOR exist.
- Phase 0 records the exact denominator inherited from `target-source-map.json` and
  `consumer-denominator.json`.
- Phase 0 records how `selected_write_requires_review` becomes machine field review through
  ingestion-worker `targetFieldReviews`.
- Future preview phases depend on the extraction quality and machine review gate.
- Phase 1-7 outlines exist but are not executable plans yet.
- `.planning/WORKSTREAMS.md` lists this workstream as active.
- `STATE.md` points to this Phase 0 plan.

## Verification

```bash
gsd-sdk query workstream.status official-web-service-info-target-expansion --raw --cwd "$PWD"
pnpm docs:lint
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- field denominator decisions
- denominator/config reconciliation decisions
- machine review semantics
- excluded surfaces
- ownership decisions
- verification evidence
