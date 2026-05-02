---
doc_type: index
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Service Info Target Expansion

This native workstream plans the next official-web expansion after
`official-web-target-inventory`.

It is not a broad crawl restart. It takes the completed target-first collector and accepted target
inventory model, then expands only official-web targets that can feed downstream campus service
information.

## Current Status

- status: `active`
- current phase: `Phase 0`
- current slice: boundary and downstream field denominator
- active implementation: planning only
- owner: Codex session

## Target Shape

The desired path is:

`downstream field gap -> explicit official-web target candidate -> field denominator gate ->
no-promotion preview -> machine field review summary -> ingestion-owned selected-write release task
-> current structured projection -> app-api/panel/operator-safe consumption`

The initial downstream surfaces are:

- `campus_services/contact_directory`
- `campus_services/service_guide`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- field denominator: `./FIELD-DENOMINATOR.md`
- Phase 0 plan: `./phases/phase-00-boundary-and-field-denominator/PLAN.md`

## Phase Plans

- Phase 0: `./phases/phase-00-boundary-and-field-denominator/PLAN.md`
- Phase 1: `./phases/phase-01-source-target-gap-inventory/OUTLINE.md`
- Phase 2: `./phases/phase-02-extraction-quality-and-machine-review-gate/OUTLINE.md`
- Phase 3: `./phases/phase-03-contact-directory-preview/OUTLINE.md`
- Phase 4: `./phases/phase-04-service-guide-preview/OUTLINE.md`
- Phase 5: `./phases/phase-05-selected-write-release-handoff/OUTLINE.md`
- Phase 6: `./phases/phase-06-runtime-consumption-verification/OUTLINE.md`
- Phase 7: `./phases/phase-07-closeout/OUTLINE.md`

## Boundary Notes

- This workstream does not reopen host-level broad crawl.
- This workstream does not open `official_web/fresh_news` or
  `official_web/news_archive`.
- This workstream does not promote source-truth directly into current read models.
- This workstream does not add a manual approval step as the normal release path.
  `selected_write_requires_review` is interpreted as ingestion-owned machine field review for
  contact/service targets; deterministic extraction must either pass the selected-write gate or
  classify the candidate as blocked with source-backed reasons.
- This workstream does not move selected-write mutation into `apps/app-api`.
- This workstream does not make protected panel read object storage, local collector files, or
  ingestion-worker internals.
- This workstream excludes pure news, marketing, leadership profile and school overview pages
  unless a page contains target service-info fields consumed by the two surfaces above.

## Relationship To Existing Workstreams

- `official-web-targeted-collection-refactor` completed target-first collection mechanics.
- `official-web-target-inventory` completed the inventory contract, candidate states and
  selected-write handoff shape.
- `official-web-collection-restart-closeout` remains a closeout/evidence lane, not the owner of
  this service-info expansion.
- This workstream consumes the inventory and selected-write handoff produced by
  `official-web-target-inventory`, then plans a bounded expansion of service-info targets.
