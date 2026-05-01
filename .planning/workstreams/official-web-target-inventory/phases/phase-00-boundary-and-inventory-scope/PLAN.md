---
doc_type: plan
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Plan: Boundary And Inventory Scope

## Goal

Freeze the `official-web-target-inventory` workstream boundary before any target expansion or
selected-write implementation begins.

## Inputs

- `docs/architecture/domains/official-web/architecture.md`
- `docs/data/official-web-source-truth-schema.md`
- `docs/policies/official-web-crawl-policy.md`
- `configs/sources/official_web/muc_public/target-source-map.json`
- `configs/sources/official_web/muc_public/consumer-denominator.json`
- `.planning/workstreams/official-web-targeted-collection-refactor/CLOSEOUT.md`

## Tasks

1. Confirm this workstream starts after target-first collection refactor closeout.
2. Freeze allowed downstream surfaces:
   - `service_guide_lookup`
   - `contact_directory_lookup`
   - `official_web/stable_reference`
3. Mark `notice_news_candidate` as inventory-only and excluded from runtime opening.
4. Record non-goals:
   - broad crawl
   - news/archive runtime opening
   - direct current-truth writes
   - authenticated notice collection
5. Define target inventory review states and selected-write handoff boundary.
6. Decide target inventory contract ownership:
   - target-source-map remains family-level admission truth
   - page-level inventory lives in a separate target inventory manifest
7. Freeze relationship to `official-web-collection-restart-closeout`.
8. Update workstream registry and state.

## Acceptance Criteria

- README, REQUIREMENTS, ROADMAP and target inventory design docs exist.
- Later phases are planned as outlines and are not executable until promoted.
- `.planning/WORKSTREAMS.md` lists this workstream as active.
- `STATE.md` points to Phase 1 as the next phase after Phase 0 summary.

## Verification

```bash
gsd-sdk query workstream.status official-web-target-inventory --raw --cwd "$PWD"
pnpm docs:lint
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- files changed
- boundary decisions
- downstream surfaces admitted
- excluded surfaces
- verification evidence
