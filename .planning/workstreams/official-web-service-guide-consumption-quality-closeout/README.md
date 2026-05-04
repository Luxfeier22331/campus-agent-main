---
doc_type: index
status: completed
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Service Guide Consumption Quality Closeout

This workstream closes the quality gap between target-first `official_web` service-guide
collection and user-facing `service_guide_lookup` answers.

The workstream starts from the current accepted direction:

`official_web source-truth -> target-first service_guide_candidate -> ingestion-owned selected-write
release -> campus_services/service_guide projection -> service_guide_lookup`

It exists because recent no-promotion replay showed that extraction completeness has improved, but
query consumption quality is still not fully closed: VPN-like pages expose multiple procedure modes
as a flat `process_steps` list, tool answers concatenate too much, real source material still
contains shell/noisy rows, field-level provenance is not consistently surfaced, and release gates do
not yet measure product-answer focus.

## Current Status

- status: `completed`
- current phase: `Phase 9 closeout complete`
- current slice: grouped-procedure contract, focused runtime behavior, no-promotion replay proof
  and isolated selected-write publish proof are all closed with retained artifacts and closeout
  docs
- owner: Codex session

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- gap review: `./GAP-REVIEW.md`
- phase plans: `./phases/`
- closeout: `./CLOSEOUT.md`

## Boundary Notes

- This workstream does not reopen broad official-web crawl.
- This workstream does not open `fresh_news` or `news_archive`.
- This workstream does not add transaction execution, booking, submission or work-order behavior.
- This workstream does not move selected-write mutation into `apps/app-api`.
- This workstream does not make `service_catalog` a query-serving fallback.
- The runtime owner remains `campus-services-agent`; the data-plane owner remains
  `packages/ingestion-core` / `apps/ingestion-worker`.

## Implementation Result

- canonical grouped procedure and focused section metadata now flow from selected-write projection
  to runtime answer shaping
- official-web service-guide composition is role-driven and fail-closes ambiguous inputs
- no-promotion source-pack proof passes on retained artifacts
- isolated selected-write publish proof passes against an isolated PG/object-store target
- closeout evidence is recorded in `./CLOSEOUT.md`
