---
doc_type: index
status: complete
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Target Inventory

This native workstream owns the target inventory layer after
`official-web-targeted-collection-refactor`.

It answers a narrower question than the collector refactor:

- which public official-web pages should be collected because a current downstream surface can
  consume them
- what fields each target must provide before it can move beyond staged candidate evidence
- how no-promotion preview evidence, review policy and selected-write readiness are recorded per
  target

## Current Status

- status: `complete`
- current phase: `closeout complete`
- current slice: selected-write handoff only
- active implementation: no
- owner: Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- inventory design: `./TARGET-INVENTORY-DESIGN.md`
- closeout: `./CLOSEOUT.md`
- selected-write handoff: `./SELECTED-WRITE-HANDOFF.md`

## Phase Plans

- Phase 0: `./phases/phase-00-boundary-and-inventory-scope/PLAN.md`
- Phase 1: `./phases/phase-01-downstream-surface-taxonomy/PLAN.md`
- Phase 2: `./phases/phase-02-inventory-contract-and-validation/PLAN.md`
- Phase 3: `./phases/phase-03-candidate-source-discovery/PLAN.md`
- Phase 4: `./phases/phase-04-field-completeness-matrix/PLAN.md`
- Phase 5: `./phases/phase-05-no-promotion-preview-batch/PLAN.md`
- Phase 6: `./phases/phase-06-selected-write-readiness/PLAN.md`
- Phase 7: `./phases/phase-07-operator-inventory-surface/PLAN.md`
- Phase 8: `./phases/phase-08-closeout-and-handoff/PLAN.md`

## Boundary Notes

- This workstream does not reopen broad crawl.
- This workstream does not open `official_web/fresh_news` or
  `official_web/news_archive`.
- This workstream does not write service catalog current truth directly.
- This workstream does not let protected-panel-web read object storage or ingestion-local files
  directly.
- This workstream does not replace authenticated notice consumption.
- This workstream may update `target-source-map.json`, inventory validation, preview reports and
  operator read models only to support target-level admission and review.
- This workstream does not add page-level inventory fields to `target-source-map.json`; those live
  in a separate target inventory manifest unless a later architecture decision explicitly upgrades
  the target-source-map schema.

## Relationship To Existing Workstreams

- `official-web-targeted-collection-refactor` completed the target-first collection pipeline.
- `official-web-consumer-denominator-recovery` established consumer-family retention gates.
- `official-web-collection-restart-closeout` remains active for closeout evidence, but its scheduler
  expansion, import and promote handoff work is gated by this inventory until accepted targets have
  source-backed preview evidence.
- This workstream turns those broad target declarations into an auditable target inventory.
- A later selected-write implementation workstream may consume the accepted target inventory.
